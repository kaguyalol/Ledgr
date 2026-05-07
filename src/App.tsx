import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// ── Types ────────────────────────────────────────────────
interface Transaction {
  date: string;
  description: string;
  amount: number;
  category: string;
}

interface TransactionWithMeta extends Transaction {
  bank: string;
  stmtId: string;
}

interface Statement {
  id: string;
  name: string;
  bank: string;
  date: string;
  size: string;
  content: string;
  transactions: Transaction[];
  isPdf: boolean;
}

interface PieDataItem {
  name: string;
  value: number;
}

interface MonthlyDataItem {
  month: string;
  income: number;
  expenses: number;
}

interface CategoryDef {
  name: string;
  keys: string[];
}

// ── Constants ────────────────────────────────────────────
const C = {
  ink: "#0e0e0e", parchment: "#f5f0e8", cream: "#faf7f2",
  gold: "#c8963e", sage: "#4a5e4a", rust: "#9b4a2e",
  muted: "#8a8070", border: "#d8cfc0", card: "#fffdf8",
  blue: "#3a5a8a", teal: "#2a7a6a",
} as const;

const fH = "'Cormorant Garamond', Georgia, serif";
const fM = "'DM Mono', Menlo, monospace";

const PIE_COLORS = [
  "#c8963e","#9b4a2e","#4a5e4a","#3a5a8a","#2a7a6a","#7a4a8a",
  "#8a6a3a","#5a3a2a","#6a8a4a","#4a6a8a","#8a4a5a","#3a8a7a",
  "#a07030","#605040","#408060","#506080",
];

const CATEGORIES: CategoryDef[] = [
  { name: "Housing", keys: ["rent", "mortgage", "hoa", "property tax", "home", "apartment", "lease"] },
  { name: "Groceries", keys: ["grocery", "groceries", "whole foods", "trader joe", "kroger", "safeway", "walmart", "costco", "aldi", "publix", "food lion", "heb ", "wegmans", "sprouts"] },
  { name: "Dining", keys: ["restaurant", "cafe", "coffee", "starbucks", "mcdonald", "uber eats", "doordash", "grubhub", "chipotle", "pizza", "sushi", "bar ", "grill", "diner", "taco", "burger", "panda express", "chick-fil-a", "wendy", "dunkin", "panera", "subway", "kfc"] },
  { name: "Transport", keys: ["gas", "fuel", "shell", "chevron", "exxon", "uber ", "lyft", "parking", "toll", "transit", "metro", "bus", "train", "airline", "flight", "southwest", "delta air", "united air", "american air", "amtrak", "bp ", "sunoco", "speedway"] },
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
  { name: "Pets", keys: ["vet", "veterinar", "pet", "petco", "petsmart", "chewy"] },
];

// ── Categorizer ──────────────────────────────────────────
function categorize(desc: string): string {
  const d = desc.toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keys.some((k) => d.includes(k))) return cat.name;
  }
  return "Other";
}

// ── PDF extraction ───────────────────────────────────────
import type { TextItem } from "pdfjs-dist/types/src/display/api";

async function extractPdf(file: File): Promise<string> {
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

// ── Transaction parser ───────────────────────────────────
function parseTxns(text: string): Transaction[] {
  const lines = text.split("\n").filter((l) => l.trim());
  let txns: Transaction[] = [];

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

  // Dedupe
  const seen = new Set<string>();
  return txns.filter((t) => {
    const k = `${t.date}|${t.description.slice(0, 20)}|${t.amount}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Helpers ──────────────────────────────────────────────
function inferBank(n: string): string {
  const l = n.toLowerCase();
  const map: [string, string][] = [
    ["chase","Chase"],["bofa","Bank of America"],["bank_of_america","Bank of America"],
    ["wells","Wells Fargo"],["citi","Citibank"],["amex","Amex"],["capital","Capital One"],
    ["discover","Discover"],["usaa","USAA"],["schwab","Schwab"],["fidelity","Fidelity"],
  ];
  for (const [k, v] of map) if (l.includes(k)) return v;
  return "Statement";
}

function fmtSize(b: number): string {
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

function fmtAmt(n: number): string {
  return (n >= 0 ? "+" : "") + "$" + Math.abs(n).toLocaleString("en", { minimumFractionDigits: 2 });
}

// ── Persistence ──────────────────────────────────────────
interface StoredStatement {
  id: string; name: string; bank: string; date: string;
  size: string; content: string; isPdf: boolean;
}

function saveData(stmts: Statement[]): void {
  try {
    const data: StoredStatement[] = stmts.map((s) => ({
      id: s.id, name: s.name, bank: s.bank, date: s.date,
      size: s.size, content: s.content.slice(0, 60000), isPdf: s.isPdf,
    }));
    localStorage.setItem("ledgr-data", JSON.stringify(data));
  } catch (e) { console.warn("Save failed:", e); }
}

function loadData(): Statement[] {
  try {
    const raw = localStorage.getItem("ledgr-data");
    if (raw) {
      return (JSON.parse(raw) as StoredStatement[]).map((s) => ({
        ...s, transactions: parseTxns(s.content),
      }));
    }
  } catch (e) { console.warn("Load failed:", e); }
  return [];
}

// ── Chart components ─────────────────────────────────────
interface PieLabelProps {
  cx: number; cy: number; midAngle: number;
  outerRadius: number; percent: number; name: string;
}

function PieLabel({ cx, cy, midAngle, outerRadius, percent, name }: PieLabelProps) {
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const r = outerRadius + 22;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill={C.ink} textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central" style={{ fontSize: "0.6rem", fontFamily: fM }}>
      {name} {(percent * 100).toFixed(0)}%
    </text>
  );
}

interface TooltipPayloadItem {
  name: string; value: number; color: string;
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: TooltipPayloadItem[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.ink, color: C.parchment, padding: "8px 12px", borderRadius: 2, fontSize: "0.62rem", fontFamily: fM }}>
      <div style={{ marginBottom: 4, color: C.gold }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>
          {p.name}: ${Math.abs(p.value).toLocaleString("en", { minimumFractionDigits: 0 })}
        </div>
      ))}
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────
type TabName = "statements" | "ledger" | "analysis" | "overview";
type SortKey = "date" | "amount" | "category" | "description" | "bank";
type SortDir = "asc" | "desc";

// ═══════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState<TabName>("statements");
  const [stmts, setStmts] = useState<Statement[]>([]);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rawId, setRawId] = useState<string | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerCat, setLedgerCat] = useState("All");
  const [ledgerBank, setLedgerBank] = useState("All");
  const [ledgerSort, setLedgerSort] = useState<SortKey>("date");
  const [ledgerDir, setLedgerDir] = useState<SortDir>("desc");
  const [ledgerPage, setLedgerPage] = useState(0);
  const [analysisCat, setAnalysisCat] = useState<string | null>(null);
  const fRef = useRef<HTMLInputElement>(null);
  const ROWS = 25;

  useEffect(() => { setStmts(loadData()); setReady(true); }, []);
  useEffect(() => { if (ready) saveData(stmts); }, [stmts, ready]);

  const onFiles = useCallback(async (files: File[]) => {
    setBusy(true);
    const added: Statement[] = [];
    for (const f of files) {
      let text = "";
      const isPdf = f.name.toLowerCase().endsWith(".pdf");
      try {
        if (isPdf) {
          text = await extractPdf(f);
        } else {
          text = await new Promise<string>((res) => {
            const fr = new FileReader();
            fr.onload = (e) => res(e.target?.result as string);
            fr.readAsText(f);
          });
        }
      } catch (e) {
        text = `[Error: ${(e as Error).message}]`;
      }
      added.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: f.name,
        bank: inferBank(f.name),
        date: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        content: text,
        size: fmtSize(f.size),
        transactions: parseTxns(text),
        isPdf,
      });
    }
    setStmts((p) => [...p, ...added]);
    setBusy(false);
  }, []);

  const remove = (id: string) => setStmts((p) => p.filter((s) => s.id !== id));

  // ── Computed ─────────────────────────────────
  const allTxns: TransactionWithMeta[] = useMemo(
    () => stmts.flatMap((s) => s.transactions.map((t) => ({ ...t, bank: s.bank, stmtId: s.id }))),
    [stmts]
  );
  const debits = useMemo(() => allTxns.filter((t) => t.amount < 0), [allTxns]);
  const credits = useMemo(() => allTxns.filter((t) => t.amount > 0), [allTxns]);
  const totalIn = credits.reduce((a, t) => a + t.amount, 0);
  const totalOut = debits.reduce((a, t) => a + Math.abs(t.amount), 0);
  const banks = useMemo(() => [...new Set(stmts.map((s) => s.bank))], [stmts]);
  const cats = useMemo(() => [...new Set(allTxns.map((t) => t.category))].sort(), [allTxns]);

  const pieData: PieDataItem[] = useMemo(() => {
    const cm: Record<string, number> = {};
    debits.forEach((t) => { cm[t.category] = (cm[t.category] || 0) + Math.abs(t.amount); });
    return Object.entries(cm).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [debits]);

  const monthlyData: MonthlyDataItem[] = useMemo(() => {
    const mm: Record<string, MonthlyDataItem> = {};
    allTxns.forEach((t) => {
      const d = t.date || "";
      let key = "Unknown";
      const m1 = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      const m2 = d.match(/(\d{4})-(\d{2})/);
      if (m1) { const yr = m1[3].length === 2 ? "20" + m1[3] : m1[3]; key = `${yr}-${m1[1].padStart(2, "0")}`; }
      else if (m2) key = `${m2[1]}-${m2[2]}`;
      if (!mm[key]) mm[key] = { month: key, income: 0, expenses: 0 };
      if (t.amount > 0) mm[key].income += t.amount; else mm[key].expenses += Math.abs(t.amount);
    });
    return Object.values(mm).sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({ ...m, income: Math.round(m.income), expenses: Math.round(m.expenses) }));
  }, [allTxns]);

  const filteredLedger = useMemo(() => {
    let list = allTxns;
    if (ledgerBank !== "All") list = list.filter((t) => t.bank === ledgerBank);
    if (ledgerCat !== "All") list = list.filter((t) => t.category === ledgerCat);
    if (ledgerSearch) { const q = ledgerSearch.toLowerCase(); list = list.filter((t) => t.description.toLowerCase().includes(q) || t.date.includes(q)); }
    return [...list].sort((a, b) => {
      if (ledgerSort === "amount") return ledgerDir === "desc" ? Math.abs(b.amount) - Math.abs(a.amount) : Math.abs(a.amount) - Math.abs(b.amount);
      if (ledgerSort === "category") return ledgerDir === "desc" ? b.category.localeCompare(a.category) : a.category.localeCompare(b.category);
      return ledgerDir === "desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
    });
  }, [allTxns, ledgerBank, ledgerCat, ledgerSearch, ledgerSort, ledgerDir]);

  const ledgerPages = Math.ceil(filteredLedger.length / ROWS);
  const ledgerSlice = filteredLedger.slice(ledgerPage * ROWS, (ledgerPage + 1) * ROWS);

  const btn: React.CSSProperties = { fontFamily: fM, fontSize: "0.58rem", letterSpacing: "0.08em", textTransform: "uppercase", padding: "6px 12px", cursor: "pointer", borderRadius: 1 };
  const tabList: TabName[] = ["statements", "ledger", "analysis", "overview"];

  return (
    <div style={{ fontFamily: fM, background: C.cream, color: C.ink, minHeight: "100vh", fontSize: 13 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}} *{box-sizing:border-box;margin:0;padding:0} body{background:${C.cream}} input,select{font-family:${fM};font-size:0.65rem;}`}</style>

      {/* HEADER */}
      <header style={{ background: C.ink, color: C.parchment, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `2px solid ${C.gold}`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ fontFamily: fH, fontSize: "1.4rem", fontWeight: 300, letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, border: `1.5px solid ${C.gold}`, display: "grid", placeItems: "center", fontSize: "0.6rem", color: C.gold }}>LG</div>
          Ledgr
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: "0.45rem", letterSpacing: "0.1em", color: C.gold, textTransform: "uppercase", padding: "2px 7px", border: `1px solid ${C.gold}40` }}>100% Local</span>
          <nav style={{ display: "flex", gap: 16 }}>
            {tabList.map((t) => (
              <button key={t} onClick={() => { setTab(t); setLedgerPage(0); }} style={{ background: "none", border: "none", color: C.parchment, fontFamily: fM, fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer", opacity: tab === t ? 1 : 0.45, borderBottom: tab === t ? `1px solid ${C.gold}` : "1px solid transparent", paddingBottom: 3 }}>{t}</button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px" }}>

        {/* STATEMENTS */}
        {tab === "statements" && (<div>
          <div style={{ fontFamily: fH, fontSize: "1.7rem", fontWeight: 300, marginBottom: 4 }}>Bank Statements</div>
          <div style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase", marginBottom: 22 }}>Upload PDF, CSV, or TXT · processed on your machine</div>
          <div style={{ border: `1.5px dashed ${drag ? C.gold : C.border}`, padding: "40px 24px", textAlign: "center", cursor: busy ? "wait" : "pointer", background: drag ? "#fffbf0" : C.card, borderRadius: 2 }}
            onClick={() => !busy && fRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(Array.from(e.dataTransfer.files)); }}>
            {busy
              ? <><span style={{ display: "inline-block", width: 24, height: 24, border: `2px solid ${C.border}`, borderTopColor: C.gold, borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 10 }} /><div style={{ fontFamily: fH, fontSize: "1rem" }}>Processing PDF…</div></>
              : <><div style={{ width: 40, height: 40, margin: "0 auto 12px", border: `1.5px solid ${drag ? C.gold : C.border}`, borderRadius: "50%", display: "grid", placeItems: "center", color: drag ? C.gold : C.muted, fontSize: "1rem" }}>↑</div><div style={{ fontFamily: fH, fontSize: "1.1rem", marginBottom: 4 }}>Drop statements here</div><div style={{ fontSize: "0.55rem", color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>PDF · CSV · TXT — multiple files supported</div></>}
            <input ref={fRef} type="file" accept=".pdf,.csv,.txt,.tsv" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files) onFiles(Array.from(e.target.files)); e.target.value = ""; }} />
          </div>
          {stmts.length === 0 && !busy ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted }}><div style={{ fontSize: "2rem", marginBottom: 12, opacity: 0.3 }}>🏦</div><div style={{ fontFamily: fH, fontSize: "1.2rem", fontWeight: 300, color: C.ink }}>No statements yet</div></div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 20 }}>
              {stmts.map((st) => (
                <div key={st.id} style={{ background: C.card, border: `1px solid ${C.border}`, padding: "16px 18px", borderRadius: 2, animation: "fadeIn 0.3s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div><div style={{ fontFamily: fH, fontSize: "1rem", fontWeight: 600, marginBottom: 2 }}>{st.bank}</div><div style={{ fontSize: "0.55rem", letterSpacing: "0.08em", color: C.muted, textTransform: "uppercase" }}>{st.name} · {st.size}</div></div>
                    {st.isPdf && <span style={{ fontSize: "0.48rem", color: C.rust, border: `1px solid ${C.rust}40`, padding: "2px 5px", textTransform: "uppercase" }}>PDF</span>}
                  </div>
                  <div style={{ fontSize: "0.6rem", color: st.transactions.length > 0 ? C.sage : C.rust, margin: "8px 0 12px" }}>{st.transactions.length > 0 ? `${st.transactions.length} transactions ✓` : "No transactions parsed"}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button style={{ ...btn, background: "none", color: C.muted, border: `1px solid ${C.border}` }} onClick={() => setRawId(rawId === st.id ? null : st.id)}>{rawId === st.id ? "Hide" : "Raw"}</button>
                    <button style={{ ...btn, background: "none", color: C.rust, border: "1px solid transparent" }} onClick={() => remove(st.id)}>Remove</button>
                  </div>
                  {rawId === st.id && <pre style={{ marginTop: 10, padding: 10, background: C.parchment, border: `1px solid ${C.border}`, borderRadius: 2, fontSize: "0.55rem", lineHeight: 1.5, maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{st.content.slice(0, 8000)}</pre>}
                </div>
              ))}
            </div>
          )}
        </div>)}

        {/* LEDGER */}
        {tab === "ledger" && (<div>
          <div style={{ fontFamily: fH, fontSize: "1.7rem", fontWeight: 300, marginBottom: 4 }}>Transaction Ledger</div>
          <div style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase", marginBottom: 20 }}>{allTxns.length} transactions across {stmts.length} statements</div>
          {allTxns.length === 0 ? (
            <div style={{ textAlign: "center", padding: 50, color: C.muted }}><div style={{ fontFamily: fH, fontSize: "1.2rem", fontWeight: 300, color: C.ink }}>Upload statements first</div></div>
          ) : (<>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
              <input value={ledgerSearch} onChange={(e) => { setLedgerSearch(e.target.value); setLedgerPage(0); }} placeholder="Search transactions…" style={{ padding: "7px 12px", border: `1px solid ${C.border}`, background: C.card, borderRadius: 1, width: 220, outline: "none" }} />
              <select value={ledgerCat} onChange={(e) => { setLedgerCat(e.target.value); setLedgerPage(0); }} style={{ padding: "7px 10px", border: `1px solid ${C.border}`, background: C.card, borderRadius: 1 }}>
                <option value="All">All Categories</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={ledgerBank} onChange={(e) => { setLedgerBank(e.target.value); setLedgerPage(0); }} style={{ padding: "7px 10px", border: `1px solid ${C.border}`, background: C.card, borderRadius: 1 }}>
                <option value="All">All Accounts</option>
                {banks.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <span style={{ fontSize: "0.58rem", color: C.muted }}>{filteredLedger.length} results</span>
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden", background: C.card }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.65rem" }}>
                  <thead><tr style={{ background: C.parchment }}>
                    {([["date","Date"],["description","Description"],["category","Category"],["bank","Account"],["amount","Amount"]] as const).map(([k, l]) => (
                      <th key={k} onClick={() => { if (ledgerSort === k) setLedgerDir(ledgerDir === "desc" ? "asc" : "desc"); else { setLedgerSort(k); setLedgerDir("desc"); } setLedgerPage(0); }}
                        style={{ padding: "9px 10px", textAlign: "left", fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: "0.53rem", color: ledgerSort === k ? C.gold : C.muted, borderBottom: `1px solid ${C.border}`, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                        {l} {ledgerSort === k ? (ledgerDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>{ledgerSlice.map((t, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}12` }}>
                      <td style={{ padding: "7px 10px", color: C.muted, whiteSpace: "nowrap" }}>{t.date}</td>
                      <td style={{ padding: "7px 10px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</td>
                      <td style={{ padding: "7px 10px", color: C.muted }}>{t.category}</td>
                      <td style={{ padding: "7px 10px", color: C.muted, fontSize: "0.58rem" }}>{t.bank}</td>
                      <td style={{ padding: "7px 10px", fontWeight: 500, color: t.amount >= 0 ? C.sage : C.rust, whiteSpace: "nowrap", textAlign: "right" }}>{fmtAmt(t.amount)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {ledgerPages > 1 && (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px", borderTop: `1px solid ${C.border}` }}>
                  <button onClick={() => setLedgerPage(Math.max(0, ledgerPage - 1))} disabled={ledgerPage === 0} style={{ ...btn, opacity: ledgerPage === 0 ? 0.3 : 1, border: `1px solid ${C.border}`, background: "none" }}>← Prev</button>
                  <span style={{ fontSize: "0.58rem", color: C.muted }}>{ledgerPage + 1} / {ledgerPages}</span>
                  <button onClick={() => setLedgerPage(Math.min(ledgerPages - 1, ledgerPage + 1))} disabled={ledgerPage >= ledgerPages - 1} style={{ ...btn, opacity: ledgerPage >= ledgerPages - 1 ? 0.3 : 1, border: `1px solid ${C.border}`, background: "none" }}>Next →</button>
                </div>
              )}
            </div>
          </>)}
        </div>)}

        {/* ANALYSIS */}
        {tab === "analysis" && (<div>
          <div style={{ fontFamily: fH, fontSize: "1.7rem", fontWeight: 300, marginBottom: 4 }}>Spending Analysis</div>
          <div style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase", marginBottom: 24 }}>Visual breakdown of your finances</div>
          {allTxns.length === 0 ? (
            <div style={{ textAlign: "center", padding: 50, color: C.muted }}><div style={{ fontFamily: fH, fontSize: "1.2rem", fontWeight: 300, color: C.ink }}>Upload statements first</div></div>
          ) : (<>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 2, padding: "20px 16px" }}>
                <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 12 }}>Expense Categories</div>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} innerRadius={45} dataKey="value" labelLine={false} label={PieLabel}
                      onClick={(d: PieDataItem) => setAnalysisCat(analysisCat === d.name ? null : d.name)}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke={C.card} strokeWidth={2} style={{ cursor: "pointer", opacity: analysisCat && analysisCat !== pieData[i]?.name ? 0.35 : 1 }} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => "$" + v.toLocaleString()} contentStyle={{ fontFamily: fM, fontSize: "0.62rem", background: C.ink, color: C.parchment, border: "none", borderRadius: 2 }} />
                  </PieChart>
                </ResponsiveContainer>
                {analysisCat && <div style={{ textAlign: "center", fontSize: "0.58rem", color: C.gold, marginTop: 4 }}>Showing: {analysisCat} · <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => setAnalysisCat(null)}>clear</span></div>}
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 2, padding: "20px 18px", overflowY: "auto", maxHeight: 380 }}>
                <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 12 }}>Category Breakdown</div>
                {pieData.map((d, i) => {
                  const pct = totalOut > 0 ? (d.value / totalOut * 100).toFixed(1) : "0";
                  const active = !analysisCat || analysisCat === d.name;
                  return (
                    <div key={d.name} onClick={() => setAnalysisCat(analysisCat === d.name ? null : d.name)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}15`, cursor: "pointer", opacity: active ? 1 : 0.35, transition: "opacity 0.2s" }}>
                      <div style={{ width: 10, height: 10, borderRadius: 1, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: "0.65rem" }}>{d.name}</div>
                      <div style={{ fontSize: "0.65rem", fontWeight: 500, textAlign: "right" }}>${d.value.toLocaleString()}</div>
                      <div style={{ fontSize: "0.55rem", color: C.muted, width: 40, textAlign: "right" }}>{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
            {monthlyData.length > 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 2, padding: "20px 18px", marginBottom: 24 }}>
                <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 12 }}>Monthly Cash Flow</div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={monthlyData} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: fM, fill: C.muted }} />
                    <YAxis tick={{ fontSize: 10, fontFamily: fM, fill: C.muted }} tickFormatter={(v: number) => "$" + (v / 1000).toFixed(0) + "k"} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "0.6rem", fontFamily: fM }} />
                    <Bar dataKey="income" name="Income" fill={C.sage} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="expenses" name="Expenses" fill={C.rust} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {analysisCat && (() => {
              const catTxns = debits.filter((t) => t.category === analysisCat).sort((a, b) => a.amount - b.amount);
              return (
                <div style={{ background: C.card, border: `1px solid ${C.gold}40`, borderRadius: 2, padding: "20px 18px", animation: "fadeIn 0.3s ease" }}>
                  <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.gold, marginBottom: 12 }}>{analysisCat} — {catTxns.length} txns · ${catTxns.reduce((a, t) => a + Math.abs(t.amount), 0).toLocaleString("en", { minimumFractionDigits: 2 })}</div>
                  <div style={{ maxHeight: 220, overflowY: "auto" }}>
                    {catTxns.map((t, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.border}10`, fontSize: "0.63rem" }}>
                        <span style={{ color: C.muted, width: 80, flexShrink: 0 }}>{t.date}</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</span>
                        <span style={{ color: C.rust, fontWeight: 500, flexShrink: 0, marginLeft: 10 }}>${Math.abs(t.amount).toLocaleString("en", { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>)}
        </div>)}

        {/* OVERVIEW */}
        {tab === "overview" && (<div>
          <div style={{ fontFamily: fH, fontSize: "1.7rem", fontWeight: 300, marginBottom: 4 }}>Portfolio Overview</div>
          <div style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase", marginBottom: 24 }}>Summary across all accounts</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: C.border, border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden", marginBottom: 28 }}>
            {([
              { l: "Statements", v: String(stmts.length) },
              { l: "Total Inflows", v: totalIn > 0 ? `$${totalIn.toLocaleString("en", { minimumFractionDigits: 0 })}` : "—", c: C.sage },
              { l: "Total Outflows", v: totalOut > 0 ? `$${totalOut.toLocaleString("en", { minimumFractionDigits: 0 })}` : "—", c: C.rust },
              { l: "Net Position", v: allTxns.length > 0 ? `${totalIn - totalOut >= 0 ? "+" : ""}$${(totalIn - totalOut).toLocaleString("en", { minimumFractionDigits: 0 })}` : "—", c: totalIn - totalOut >= 0 ? C.sage : C.rust },
            ] as const).map((m, i) => (
              <div key={i} style={{ background: C.card, padding: "18px 16px" }}>
                <div style={{ fontSize: "0.55rem", letterSpacing: "0.14em", textTransform: "uppercase", color: C.muted, marginBottom: 5 }}>{m.l}</div>
                <div style={{ fontFamily: fH, fontSize: "1.5rem", fontWeight: 300, color: "c" in m ? m.c : C.ink }}>{m.v}</div>
              </div>
            ))}
          </div>
          {allTxns.length === 0 ? (
            <div style={{ textAlign: "center", padding: 48, color: C.muted }}><div style={{ fontFamily: fH, fontSize: "1.2rem", fontWeight: 300, color: C.ink }}>Upload statements to see overview</div></div>
          ) : (<>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 14 }}>Accounts</div>
              {stmts.map((st) => {
                const si = st.transactions.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
                const so = st.transactions.filter((t) => t.amount < 0).reduce((a, t) => a + Math.abs(t.amount), 0);
                return (
                  <div key={st.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}20`, fontSize: "0.68rem" }}>
                    <div><strong>{st.bank}</strong> <span style={{ color: C.muted, fontSize: "0.55rem" }}>({st.transactions.length} txns · {st.name})</span></div>
                    <div style={{ display: "flex", gap: 14 }}>
                      <span style={{ color: C.sage }}>+${si.toLocaleString("en", { minimumFractionDigits: 0 })}</span>
                      <span style={{ color: C.rust }}>-${so.toLocaleString("en", { minimumFractionDigits: 0 })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 2, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, marginBottom: 14 }}>Insights</div>
              <div style={{ fontSize: "0.68rem", lineHeight: 2 }}>
                {totalIn > 0 && <div>• Savings rate: <strong style={{ color: (totalIn - totalOut) / totalIn >= 0.2 ? C.sage : C.rust }}>{((totalIn - totalOut) / totalIn * 100).toFixed(1)}%</strong></div>}
                {pieData[0] && <div>• Top expense: <strong>{pieData[0].name}</strong> at ${pieData[0].value.toLocaleString()} ({(pieData[0].value / totalOut * 100).toFixed(0)}%)</div>}
              </div>
            </div>
            <div style={{ textAlign: "center" }}>
              <button style={{ ...btn, background: "none", color: C.rust, border: `1px solid ${C.rust}40`, padding: "9px 24px" }}
                onClick={() => { localStorage.removeItem("ledgr-data"); setStmts([]); }}>
                Clear All Data
              </button>
            </div>
          </>)}
        </div>)}
      </main>
    </div>
  );
}
