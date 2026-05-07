import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type StatementType = "bank" | "credit" | "investment";

export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  category: string;
}

export function normalizeDate(raw: string, fallbackYear?: number): string {
  if (!raw) return "";
  const s = raw.trim();
  // ISO YYYY-MM-DD already
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // M/D/YYYY or M/D/YY or M-D-YYYY
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? (parseInt(m[3], 10) > 70 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    return `${yr}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // M/D (year missing) — use fallback year
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (m && fallbackYear) {
    return `${fallbackYear}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Mon DD, YYYY
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };
    const mo = months[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, "0")}`;
  }
  return s;
}

interface CategoryDef {
  name: string;
  keys: string[];
}

const CATEGORIES: CategoryDef[] = [
  { name: "Housing", keys: ["rent", "mortgage", "hoa", "property tax", "apartment", "lease"] },
  { name: "Groceries", keys: ["grocery", "groceries", "whole foods", "trader joe", "kroger", "safeway", "walmart", "costco", "aldi", "publix", "food lion", "heb", "wegmans", "sprouts"] },
  { name: "Dining", keys: ["dining", "restaurant", "cafe", "coffee", "starbucks", "mcdonald", "uber eats", "doordash", "grubhub", "chipotle", "pizza", "sushi", "bar", "grill", "diner", "taco", "burger", "bakery", "panda express", "chick-fil-a", "wendy", "dunkin", "panera", "subway", "kfc"] },
  { name: "Transport", keys: ["gas", "fuel", "shell", "chevron", "exxon", "uber", "lyft", "parking", "toll", "transit", "metro", "airline", "flight", "southwest", "delta air", "united air", "american air", "amtrak", "bp", "sunoco", "speedway"] },
  { name: "Utilities", keys: ["electric", "water bill", "gas bill", "internet", "comcast", "verizon", "at&t", "t-mobile", "phone bill", "utility", "sewage", "trash", "waste", "spectrum", "xfinity"] },
  { name: "Healthcare", keys: ["pharmacy", "cvs", "walgreens", "doctor", "hospital", "medical", "dental", "health", "copay", "prescription", "clinic", "urgent care", "labcorp"] },
  { name: "Shopping", keys: ["amazon", "ebay", "apple.com", "best buy", "nike", "nordstrom", "macy", "zara", "h&m", "ikea", "home depot", "lowes", "wayfair", "etsy", "target", "marshalls", "tj maxx"] },
  { name: "Entertainment", keys: ["netflix", "spotify", "hulu", "disney+", "hbo", "youtube", "apple tv", "gaming", "steam", "playstation", "xbox", "movie", "cinema", "concert", "ticket"] },
  { name: "Subscriptions", keys: ["subscription", "member", "premium", "annual fee", "monthly fee", "renewal", "patreon", "icloud", "dropbox", "adobe"] },
  { name: "Education", keys: ["tuition", "school", "university", "college", "course", "udemy", "coursera", "book", "textbook"] },
  { name: "Insurance", keys: ["insurance", "geico", "allstate", "state farm", "progressive", "liberty mutual", "policy"] },
  { name: "Income", keys: ["payroll", "salary", "direct dep", "deposit from", "wage", "dividend", "interest earned", "refund", "cashback", "reimbursement", "venmo from", "zelle from", "ach credit", "paycheck"] },
  { name: "Transfers", keys: ["transfer", "zelle to", "venmo to", "paypal", "wire", "ach debit"] },
  { name: "Fitness", keys: ["gym", "fitness", "peloton", "yoga", "crossfit", "planet fitness", "equinox"] },
  { name: "Childcare", keys: ["daycare", "childcare", "babysit", "nanny", "tutor", "school fee"] },
  { name: "Pets", keys: ["vet", "veterinar", "petco", "petsmart", "chewy"] },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPILED_CATEGORIES: { name: string; matcher: RegExp }[] = CATEGORIES.map((c) => {
  const alts = c.keys.map((k) => escapeRegex(k.trim())).filter(Boolean).join("|");
  return { name: c.name, matcher: new RegExp(`\\b(?:${alts})\\b`, "i") };
});

export function categorize(desc: string): string {
  for (const c of COMPILED_CATEGORIES) {
    if (c.matcher.test(desc)) return c.name;
  }
  return "Other";
}

export async function extractPdf(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const pg = await pdf.getPage(p);
    const ct = await pg.getTextContent();
    const textItems = ct.items.filter((it): it is TextItem => "str" in it);
    const sorted = [...textItems].sort((a, b) => {
      const dy = b.transform[5] - a.transform[5];
      return Math.abs(dy) > 3 ? dy : a.transform[4] - b.transform[4];
    });

    const lines: string[] = [];
    let lastY: number | null = null;
    let cur = "";
    for (const it of sorted) {
      if (lastY !== null && Math.abs(it.transform[5] - lastY) > 3) {
        if (cur.trim()) lines.push(cur.trim());
        cur = "";
      }
      cur += (cur ? "  " : "") + it.str;
      lastY = it.transform[5];
    }
    if (cur.trim()) lines.push(cur.trim());
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
}

export async function readTextFile(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = (e) => res(e.target?.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsText(f);
  });
}

export function parseTxns(text: string, type: StatementType = "bank", fallbackYear?: number): ParsedTransaction[] {
  const yr = fallbackYear ?? new Date().getFullYear();
  const lines = text.split("\n").filter((l) => l.trim());
  const txns: ParsedTransaction[] = [];

  // Strategy 1: CSV
  const csvLines = lines.filter((l) => l.split(",").length >= 3);
  if (csvLines.length > lines.length * 0.3) {
    let hi = lines.findIndex((l) => /date/i.test(l) && /amount|debit|credit|balance/i.test(l));
    if (hi === -1) hi = 0;
    const hdr = lines[hi].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
    const dc = hdr.findIndex((h) => /date/i.test(h));
    const ds = hdr.findIndex((h) => /desc|memo|narr|detail|merchant|payee|name/i.test(h));
    const ac = hdr.findIndex((h) => /^amount$|^value$/i.test(h));
    const dbc = hdr.findIndex((h) => /debit|withdrawal|expense/i.test(h));
    const crc = hdr.findIndex((h) => /credit|deposit/i.test(h));

    for (let i = hi + 1; i < lines.length; i++) {
      const cols = lines[i].match(/(".*?"|[^,]+)/g)?.map((c) => c.trim().replace(/^"|"$/g, "")) || [];
      if (cols.length < 2) continue;
      const date = dc >= 0 ? cols[dc] : cols[0];
      const d = ds >= 0 ? cols[ds] : cols[1];
      let amt = 0;
      if (ac >= 0) {
        amt = parseFloat(cols[ac]?.replace(/[$,\s"]/g, "") ?? "") || 0;
      } else {
        const db = dbc >= 0 ? parseFloat(cols[dbc]?.replace(/[$,\s"]/g, "") ?? "") || 0 : 0;
        const cr = crc >= 0 ? parseFloat(cols[crc]?.replace(/[$,\s"]/g, "") ?? "") || 0 : 0;
        amt = cr > 0 ? cr : -db;
      }
      if (date && d && amt !== 0) {
        txns.push({ date, description: d, amount: amt, category: categorize(d) });
      }
    }
  }

  // Strategy 2: Regex patterns
  if (!txns.length) {
    const pats = [
      /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-−]?\$?[\d,]+\.\d{2})\s*$/gm,
      /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s{2,}(.+?)\s{2,}([-−]?\$?[\d,]+\.\d{2})/gm,
      /(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-−]?\$?[\d,]+\.\d{2})/gm,
    ];
    for (const pat of pats) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(text)) !== null) {
        const raw = m[3].replace(/[$,\s]/g, "").replace("−", "-");
        const amt = parseFloat(raw);
        if (!isNaN(amt) && Math.abs(amt) > 0.01 && Math.abs(amt) < 1e6) {
          const d = m[2].trim().replace(/\s{2,}/g, " ");
          if (d.length >= 3 && !/^[\d.]+$/.test(d)) {
            txns.push({ date: m[1], description: d, amount: amt, category: categorize(d) });
          }
        }
      }
      if (txns.length > 2) break;
    }
  }

  // Strategy 3: Dollar amounts at end of line
  if (!txns.length) {
    for (const line of lines) {
      const dm = line.match(/^(.+?)\s+([-−]?\$[\d,]+\.\d{2})\s*$/);
      if (dm) {
        const d = dm[1].trim();
        const raw = dm[2].replace(/[$,]/g, "").replace("−", "-");
        const amt = parseFloat(raw);
        if (!isNaN(amt) && d.length >= 3) {
          const dateM = d.match(/^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+)/);
          txns.push({
            date: dateM ? dateM[1] : "—",
            description: dateM ? dateM[2].trim() : d,
            amount: amt,
            category: categorize(d),
          });
        }
      }
    }
  }

  // Normalize dates and apply sign logic for the statement type
  const normalized = txns.map((t) => {
    const date = normalizeDate(t.date, yr);
    let amount = t.amount;
    // Credit cards display purchases as positive on the statement (you owe that much).
    // Internally we use the convention: negative = money out, positive = money in.
    // Flip so charges become expenses and refunds/payments become income.
    if (type === "credit") amount = -amount;
    return { ...t, date, amount };
  });

  // Dedupe
  const seen = new Set<string>();
  const deduped = normalized.filter((t) => {
    const k = `${t.date}|${t.description.slice(0, 20)}|${t.amount}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort chronologically (oldest first). ISO dates sort lexicographically.
  deduped.sort((a, b) => a.date.localeCompare(b.date));
  return deduped;
}

export function inferBank(n: string): string {
  const l = n.toLowerCase();
  const map: [string, string][] = [
    ["chase", "Chase"], ["bofa", "Bank of America"], ["bank_of_america", "Bank of America"],
    ["wells", "Wells Fargo"], ["citi", "Citibank"], ["amex", "Amex"], ["capital", "Capital One"],
    ["discover", "Discover"], ["usaa", "USAA"], ["schwab", "Schwab"], ["fidelity", "Fidelity"],
  ];
  for (const [k, v] of map) if (l.includes(k)) return v;
  return "Statement";
}

export function fmtSize(b: number): string {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}
