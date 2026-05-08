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

export interface InvestmentSummary {
  periodStart?: string;
  periodEnd?: string;
  beginningValue: number;
  endingValue: number;
  credits: number;
  debits: number;
  securityTransfers: number;
  netFlow: number;
  changeInValue: number;
}

function parseDollar(s: string | null | undefined): number {
  if (!s) return 0;
  const t = s.trim();
  if (!t || t === "—" || t === "-") return 0;
  const cleaned = t.replace(/[$,\s]/g, "").replace("−", "-");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// Find the first line whose trimmed-lowercased text starts with `label`.
// Return [thisPeriod, thisYear] (or fewer) parsed as numbers; em-dashes count as 0.
function readSummaryRow(lines: string[], label: string): { period: number; year: number } | null {
  const target = label.toLowerCase();
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.startsWith(target)) {
      const numbers = line.match(/\$?[\d,]+\.\d{2}|—/g);
      if (!numbers || numbers.length === 0) return { period: 0, year: 0 };
      return {
        period: parseDollar(numbers[0]),
        year: numbers.length >= 2 ? parseDollar(numbers[1]) : 0,
      };
    }
  }
  return null;
}

export function parseInvestmentSummary(text: string): InvestmentSummary | null {
  const lines = text.split("\n");
  const beginning = readSummaryRow(lines, "total beginning value")
    ?? readSummaryRow(lines, "beginning account value")
    ?? readSummaryRow(lines, "beginning value");
  const ending = readSummaryRow(lines, "total ending value")
    ?? readSummaryRow(lines, "ending account value")
    ?? readSummaryRow(lines, "ending value");
  if (!beginning || !ending) return null;

  // Period dates: "(M/D/YY-M/D/YY)" — first occurrence is "This Period"
  const periodMatch = text.match(/\((\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\)/);
  const yr = new Date().getFullYear();

  const credits = readSummaryRow(lines, "credits")?.period ?? 0;
  const debits = readSummaryRow(lines, "debits")?.period ?? 0;
  const securityTransfers = readSummaryRow(lines, "security transfers")?.period ?? 0;
  const netFlow = readSummaryRow(lines, "net credits/debits/transfers")?.period
    ?? readSummaryRow(lines, "net cash flow")?.period
    ?? credits - debits + securityTransfers;
  const changeInValue = readSummaryRow(lines, "change in value")?.period
    ?? ending.period - beginning.period - netFlow;

  return {
    periodStart: periodMatch ? normalizeDate(periodMatch[1], yr) : undefined,
    periodEnd: periodMatch ? normalizeDate(periodMatch[2], yr) : undefined,
    beginningValue: beginning.period,
    endingValue: ending.period,
    credits,
    debits,
    securityTransfers,
    netFlow,
    changeInValue,
  };
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export interface StatementPeriod {
  start: string; // ISO YYYY-MM-DD
  end: string;   // ISO YYYY-MM-DD
}

export interface DateContext {
  fallbackYear?: number;
  period?: StatementPeriod;
}

// For a year-less "Mon DD" or "M/D" date, decide which year it belongs to.
// If a statement period is available, anchor to period.end and walk back if the
// transaction's month is later in the calendar year than the period end —
// that's the year-cross case (e.g. period ends Jan 14 2026, Dec 17 → 2025).
function pickYear(month: number, ctx?: DateContext): number {
  const period = ctx?.period;
  if (period) {
    const endYear = parseInt(period.end.slice(0, 4), 10);
    const endMonth = parseInt(period.end.slice(5, 7), 10);
    return month <= endMonth ? endYear : endYear - 1;
  }
  return ctx?.fallbackYear ?? new Date().getFullYear();
}

export function normalizeDate(raw: string, context?: DateContext | number): string {
  // Backwards-compat: a bare number is treated as fallbackYear.
  const ctx: DateContext = typeof context === "number"
    ? { fallbackYear: context }
    : context ?? {};

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
  // M/D (year missing) — resolve via context
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    const month = parseInt(m[1], 10);
    const yr = pickYear(month, ctx);
    return `${yr}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // Mon DD, YYYY  (e.g. "Apr 6, 2026")
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, "0")}`;
  }
  // Mon DD  (e.g. "Apr 6") — resolve via context
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()];
    if (mo) {
      const month = parseInt(mo, 10);
      const yr = pickYear(month, ctx);
      return `${yr}-${mo}-${m[2].padStart(2, "0")}`;
    }
  }
  return s;
}

// Find the billing cycle / statement period in the PDF text (e.g. Capital One's
// "Mar 16, 2026 - Apr 14, 2026" header). The first match wins, which is fine
// because the billing-cycle header tends to appear before any year-to-date or
// summary range in standard credit card / bank statement layouts.
export function extractStatementPeriod(text: string): StatementPeriod | null {
  const monDayYear = String.raw`[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}`;
  const slashYear = String.raw`\d{1,2}\/\d{1,2}\/\d{2,4}`;
  const isoDate = String.raw`\d{4}-\d{2}-\d{2}`;
  const sep = String.raw`(?:\s*[-–]\s*|\s+to\s+)`;

  const patterns = [
    new RegExp(`(${monDayYear})${sep}(${monDayYear})`, "i"),
    new RegExp(`(${slashYear})${sep}(${slashYear})`, "i"),
    new RegExp(`(${isoDate})${sep}(${isoDate})`, "i"),
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const start = normalizeDate(m[1]);
    const end = normalizeDate(m[2]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return { start, end };
    }
  }
  return null;
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

const METADATA_PATTERNS: RegExp[] = [
  /\bcredit limit\b/i,
  /\bavailable credit\b/i,
  /\bcash advance limit\b/i,
  /\bnew balance\b/i,
  /\bprevious balance\b/i,
  /\bstatement balance\b/i,
  /\bcurrent balance\b/i,
  /\bopening balance\b/i,
  /\bclosing balance\b/i,
  /\bminimum payment\b/i,
  /\bpayment due/i,
  /\baccount number\b/i,
  /\bapr\b/i,
  /\btotal fees\s+(year[- ]to[- ]date|ytd|charged)/i,
  /\btotal interest\s+(year[- ]to[- ]date|ytd|charged)/i,
  /\brewards (balance|earned|redeemed)\b/i,
  /\bpoints (balance|earned|redeemed)\b/i,
  /\bcash back (balance|earned|redeemed)\b/i,
];

function isMetadataLine(line: string): boolean {
  return METADATA_PATTERNS.some((re) => re.test(line));
}

// Section-start matches must be HEADER-ONLY lines (no trailing amount), otherwise
// summary rows like "Transactions + $918.27" trigger a false start on page 1.
const SECTION_START_PATTERNS: RegExp[] = [
  /^transactions?\s*$/i,
  /^transaction detail\s*$/i,
  /^transaction summary\s*$/i,
  /^account activity\s*$/i,
  /^account transactions\s*$/i,
  /^posted transactions\s*$/i,
  /^recent activity\s*$/i,
  /^new transactions\s*$/i,
  /^purchases? and (other charges|credits)\s*$/i,
  /^charges,?\s*credits,?\s*payments\s*$/i,
  /^date\s+description\s+amount/i,
  /^date\s+(post(ed)?\s+date\s+)?description/i,
  /^trans(action)?\s+date\b.*\bdescription\b/i,
];

const SECTION_END_PATTERNS: RegExp[] = [
  /^total fees\b/i,
  /^total interest\b/i,
  /^total purchases\b/i,
  /^total credits\b/i,
  /^total transactions\b/i,
  /^fees\s*$/i,
  /^interest charged\s*$/i,
  /^important notices?\b/i,
  /^important information/i,
  /^rewards summary\b/i,
  /^rewards earned\b/i,
  /^reward summary\b/i,
  /^year[- ]to[- ]date\b/i,
  /^totals year[- ]to[- ]date\b/i,
  /^disclosures?\b/i,
  /^information about your account/i,
  /^how to avoid finance charges/i,
  /^making payments\b/i,
];

function extractTransactionSection(text: string): string {
  const lines = text.split("\n");
  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (startIdx === -1) {
      if (SECTION_START_PATTERNS.some((re) => re.test(t))) {
        startIdx = i + 1;
      }
      continue;
    }
    if (SECTION_END_PATTERNS.some((re) => re.test(t))) {
      endIdx = i;
      break;
    }
  }
  if (startIdx === -1) return text;
  return lines.slice(startIdx, endIdx).join("\n");
}

export function parseTxns(text: string, type: StatementType = "bank", fallbackYear?: number): ParsedTransaction[] {
  const period = extractStatementPeriod(text) ?? undefined;
  const dateCtx: DateContext = {
    fallbackYear: fallbackYear ?? new Date().getFullYear(),
    period,
  };
  const sectionText = extractTransactionSection(text);
  const lines = sectionText.split("\n").filter((l) => l.trim() && !isMetadataLine(l));
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

  // Strategy 2: Regex patterns. Each pattern captures (date, description, amount).
  // Ordered most-specific-first so we don't run a generic pattern that would
  // misinterpret a Trans+Post date row as date + (date in description) + amount.
  if (!txns.length) {
    const D = `(?:\\d{1,2}[\\/\\-]\\d{1,2}(?:[\\/\\-]\\d{2,4})?|\\d{4}-\\d{1,2}-\\d{1,2}|[A-Za-z]{3}\\s+\\d{1,2}(?:,?\\s+\\d{2,4})?)`;
    const A = `[-−]?\\$?[\\d,]+\\.\\d{2}`;
    // date, desc, amount, balance — bank statements
    const PAT_DATE_DESC_AMT_BAL = new RegExp(`^(${D})\\s+(.+?)\\s+(${A})\\s+${A}\\s*$`, "gm");
    // trans-date, post-date, desc, amount — Capital One / many CC formats
    const PAT_DATE_DATE_DESC_AMT = new RegExp(`^(${D})\\s+${D}\\s+(.+?)\\s+(${A})\\s*$`, "gm");
    // date, desc, amount — generic 3-column
    const PAT_DATE_DESC_AMT = new RegExp(`^(${D})\\s+(.+?)\\s+(${A})\\s*$`, "gm");

    const ordered = type === "bank"
      ? [PAT_DATE_DESC_AMT_BAL, PAT_DATE_DATE_DESC_AMT, PAT_DATE_DESC_AMT]
      : [PAT_DATE_DATE_DESC_AMT, PAT_DATE_DESC_AMT, PAT_DATE_DESC_AMT_BAL];
    for (const pat of ordered) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(sectionText)) !== null) {
        const raw = m[3].replace(/[$,\s]/g, "").replace("−", "-");
        const amt = parseFloat(raw);
        if (!isNaN(amt) && Math.abs(amt) > 0.01 && Math.abs(amt) < 1e6) {
          const d = m[2].trim().replace(/\s{2,}/g, " ");
          if (d.length >= 3 && !/^[\d.]+$/.test(d) && !isMetadataLine(d)) {
            txns.push({ date: m[1], description: d, amount: amt, category: categorize(d) });
          }
        }
      }
      if (txns.length > 2) break;
    }
  }

  // Strategy 3: Dollar amounts at end of line — require a date prefix in the line
  // (otherwise we end up scraping balance / limit / payment-due metadata)
  if (!txns.length) {
    const datePrefix = /^((?:\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{4}-\d{1,2}-\d{1,2}|[A-Za-z]{3}\s+\d{1,2}(?:,?\s+\d{2,4})?))\s+(.+)/;
    for (const line of lines) {
      const dm = line.match(/^(.+?)\s+([-−]?\$[\d,]+\.\d{2})\s*$/);
      if (!dm) continue;
      const d = dm[1].trim();
      const raw = dm[2].replace(/[$,]/g, "").replace("−", "-");
      const amt = parseFloat(raw);
      if (isNaN(amt) || d.length < 3) continue;
      const dateM = d.match(datePrefix);
      if (!dateM) continue;
      const desc = dateM[2].trim();
      if (isMetadataLine(desc)) continue;
      txns.push({
        date: dateM[1],
        description: desc,
        amount: amt,
        category: categorize(desc),
      });
    }
  }

  // Normalize dates and apply sign logic for the statement type
  const normalized = txns.map((t) => {
    const date = normalizeDate(t.date, dateCtx);
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

const FILENAME_HINTS: [string, string][] = [
  ["chase", "Chase"], ["bofa", "Bank of America"], ["bank_of_america", "Bank of America"],
  ["wells", "Wells Fargo"], ["citi", "Citibank"], ["amex", "Amex"], ["capital", "Capital One"],
  ["discover", "Discover"], ["usaa", "USAA"], ["schwab", "Schwab"], ["fidelity", "Fidelity"],
  ["vanguard", "Vanguard"], ["robinhood", "Robinhood"], ["apple_card", "Apple Card"],
  ["venmo", "Venmo"], ["paypal", "PayPal"], ["ally", "Ally"], ["barclays", "Barclays"],
  ["coinbase", "Coinbase"], ["hsbc", "HSBC"],
  ["morgan_stanley", "Morgan Stanley"], ["morgan-stanley", "Morgan Stanley"], ["morganstanley", "Morgan Stanley"],
  ["etrade", "E*Trade"], ["e_trade", "E*Trade"], ["e-trade", "E*Trade"],
  ["tdameritrade", "TD Ameritrade"], ["td_ameritrade", "TD Ameritrade"],
  ["interactivebrokers", "Interactive Brokers"], ["ibkr", "Interactive Brokers"],
];

const CONTENT_HINTS: [RegExp, string][] = [
  [/\bmorgan stanley\b/i, "Morgan Stanley"],
  [/\be\*?trade\b/i, "E*Trade"],
  [/\bamerican express\b/i, "Amex"],
  [/\bjpmorgan chase\b|\bchase bank\b/i, "Chase"],
  [/\bbank of america\b/i, "Bank of America"],
  [/\bwells fargo\b/i, "Wells Fargo"],
  [/\bcitibank\b|\bciti cards?\b/i, "Citibank"],
  [/\bcapital one\b/i, "Capital One"],
  [/\bdiscover (card|bank|financial)\b/i, "Discover"],
  [/\busaa\b/i, "USAA"],
  [/\bcharles schwab\b/i, "Schwab"],
  [/\bfidelity (investments|brokerage)\b/i, "Fidelity"],
  [/\bvanguard\b/i, "Vanguard"],
  [/\brobinhood\b/i, "Robinhood"],
  [/\bapple card\b/i, "Apple Card"],
  [/\bgoldman sachs\b/i, "Goldman Sachs"],
  [/\bvenmo\b/i, "Venmo"],
  [/\bpaypal\b/i, "PayPal"],
  [/\bally bank\b/i, "Ally"],
  [/\bbarclays\b/i, "Barclays"],
  [/\bcoinbase\b/i, "Coinbase"],
  [/\bhsbc\b/i, "HSBC"],
  [/\btd ameritrade\b/i, "TD Ameritrade"],
  [/\binteractive brokers\b/i, "Interactive Brokers"],
];

export function inferBank(filename: string, content?: string): string {
  const fl = filename.toLowerCase();
  for (const [k, v] of FILENAME_HINTS) {
    if (fl.includes(k)) return v;
  }
  if (content) {
    const slice = content.slice(0, 4000);
    for (const [re, name] of CONTENT_HINTS) {
      if (re.test(slice)) return name;
    }
  }
  return "Statement";
}

export function fmtSize(b: number): string {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}
