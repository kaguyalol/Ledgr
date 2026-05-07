import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  addStatement, getAllStatements, getAllTransactions,
  deleteStatement, clearAll, exportData, importData,
  updateTransactionCategories,
  type DbStatement, type DbTransaction, type BackupPayload,
  type StatementType,
} from "./db";
import { extractPdf, readTextFile, parseTxns, categorize, inferBank, fmtSize, normalizeDate } from "./parser";

// ── Types ────────────────────────────────────────────────
interface TransactionWithMeta {
  date: string;
  description: string;
  amount: number;
  category: string;
  bank: string;
  stmtId: string;
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

function fmtAmt(n: number): string {
  return (n >= 0 ? "+" : "") + "$" + Math.abs(n).toLocaleString("en", { minimumFractionDigits: 2 });
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
  const [stmts, setStmts] = useState<DbStatement[]>([]);
  const [txns, setTxns] = useState<DbTransaction[]>([]);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerCat, setLedgerCat] = useState("All");
  const [ledgerBank, setLedgerBank] = useState("All");
  const [ledgerSort, setLedgerSort] = useState<SortKey>("date");
  const [ledgerDir, setLedgerDir] = useState<SortDir>("desc");
  const [ledgerPage, setLedgerPage] = useState(0);
  const [analysisCat, setAnalysisCat] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<StatementType>("bank");
  const fRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const ROWS = 25;

  useEffect(() => {
    (async () => {
      try {
        const [s, t] = await Promise.all([getAllStatements(), getAllTransactions()]);
        setStmts(s);
        setTxns(t);
      } catch (e) {
        console.warn("Load failed:", e);
      }
      setReady(true);
    })();
  }, []);

  const onFiles = useCallback(async (files: File[], type: StatementType) => {
    setBusy(true);
    for (const f of files) {
      const isPdf = f.name.toLowerCase().endsWith(".pdf");
      let text = "";
      try {
        text = isPdf ? await extractPdf(f) : await readTextFile(f);
      } catch (e) {
        console.error("Parse failed for", f.name, e);
        continue;
      }
      const parsed = parseTxns(text, type);
      const stmt: DbStatement = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: f.name,
        bank: inferBank(f.name),
        date: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        size: fmtSize(f.size),
        txnCount: parsed.length,
        isPdf,
        type,
      };
      const dbTxns: Omit<DbTransaction, "id">[] = parsed.map((p) => ({
        stmtId: stmt.id,
        date: p.date,
        description: p.description,
        amount: p.amount,
        category: p.category,
      }));
      try {
        await addStatement(stmt, dbTxns);
        setStmts((p) => [...p, stmt]);
        setTxns((p) => [...p, ...(dbTxns as DbTransaction[])]);
      } catch (e) {
        console.error("DB write failed:", e);
      }
    }
    setBusy(false);
  }, []);

  const remove = async (id: string) => {
    try {
      await deleteStatement(id);
      setStmts((p) => p.filter((s) => s.id !== id));
      setTxns((p) => p.filter((t) => t.stmtId !== id));
    } catch (e) { console.error("Delete failed:", e); }
  };

  const onClearAll = async () => {
    if (!confirm("Delete all statements and transactions? This cannot be undone.")) return;
    try {
      await clearAll();
      setStmts([]);
      setTxns([]);
    } catch (e) { console.error("Clear failed:", e); }
  };

  const onExport = async () => {
    try {
      const payload = await exportData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledgr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { console.error("Export failed:", e); alert("Export failed: " + (e as Error).message); }
  };

  const onRecategorize = async () => {
    const updates: { id: number; category: string }[] = [];
    for (const t of txns) {
      if (t.id === undefined) continue;
      const newCat = categorize(t.description);
      if (newCat !== t.category) updates.push({ id: t.id, category: newCat });
    }
    if (!updates.length) {
      alert("No category changes needed.");
      return;
    }
    try {
      await updateTransactionCategories(updates);
      const updatedMap = new Map(updates.map((u) => [u.id, u.category]));
      setTxns((p) => p.map((t) => (t.id !== undefined && updatedMap.has(t.id) ? { ...t, category: updatedMap.get(t.id)! } : t)));
      alert(`Re-categorized ${updates.length} transaction${updates.length === 1 ? "" : "s"}.`);
    } catch (e) {
      console.error("Recategorize failed:", e);
      alert("Re-categorize failed: " + (e as Error).message);
    }
  };

  const onImport = async (file: File) => {
    if (!confirm("Replace ALL current data with this backup? This cannot be undone.")) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as BackupPayload;
      await importData(payload);
      const [s, t] = await Promise.all([getAllStatements(), getAllTransactions()]);
      setStmts(s);
      setTxns(t);
      alert(`Restored ${s.length} statements and ${t.length} transactions.`);
    } catch (e) {
      console.error("Import failed:", e);
      alert("Import failed: " + (e as Error).message);
    }
  };

  // ── Computed ─────────────────────────────────
  const bankByStmt = useMemo(() => {
    const m: Record<string, string> = {};
    stmts.forEach((s) => { m[s.id] = s.bank; });
    return m;
  }, [stmts]);

  const currentYear = new Date().getFullYear();
  const allTxns: TransactionWithMeta[] = useMemo(
    () => txns.map((t) => ({
      date: normalizeDate(t.date, currentYear),
      description: t.description,
      amount: t.amount,
      category: t.category,
      bank: bankByStmt[t.stmtId] ?? "Unknown",
      stmtId: t.stmtId,
    })),
    [txns, bankByStmt, currentYear]
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
      const key = t.date.match(/^(\d{4})-(\d{2})/)?.[0] ?? "Unknown";
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

  if (!ready) {
    return <div style={{ fontFamily: fM, background: C.cream, minHeight: "100vh", display: "grid", placeItems: "center", color: C.muted, fontSize: "0.7rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>Loading…</div>;
  }

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
          <div style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase", marginBottom: 14 }}>Upload PDF, CSV, or TXT · processed on your machine</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.55rem", letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted }}>Statement type:</span>
            {(["bank", "credit", "investment"] as const).map((t) => {
              const labels: Record<StatementType, string> = { bank: "Bank Account", credit: "Credit Card", investment: "Investment" };
              const active = uploadType === t;
              return (
                <button key={t} onClick={() => setUploadType(t)} disabled={busy}
                  style={{
                    fontFamily: fM, fontSize: "0.58rem", letterSpacing: "0.08em", textTransform: "uppercase",
                    padding: "5px 12px", cursor: busy ? "not-allowed" : "pointer", borderRadius: 1,
                    background: active ? C.ink : "none",
                    color: active ? C.parchment : C.muted,
                    border: `1px solid ${active ? C.ink : C.border}`,
                  }}>
                  {labels[t]}
                </button>
              );
            })}
            <span style={{ fontSize: "0.55rem", color: C.muted, marginLeft: "auto" }}>
              {uploadType === "credit" ? "Charges treated as expenses (sign flipped)" : uploadType === "investment" ? "Signs preserved as-is" : "+ income, − expenses"}
            </span>
          </div>
          <div style={{ border: `1.5px dashed ${drag ? C.gold : C.border}`, padding: "40px 24px", textAlign: "center", cursor: busy ? "wait" : "pointer", background: drag ? "#fffbf0" : C.card, borderRadius: 2 }}
            onClick={() => !busy && fRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(Array.from(e.dataTransfer.files), uploadType); }}>
            {busy
              ? <><span style={{ display: "inline-block", width: 24, height: 24, border: `2px solid ${C.border}`, borderTopColor: C.gold, borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 10 }} /><div style={{ fontFamily: fH, fontSize: "1rem" }}>Processing…</div></>
              : <><div style={{ width: 40, height: 40, margin: "0 auto 12px", border: `1.5px solid ${drag ? C.gold : C.border}`, borderRadius: "50%", display: "grid", placeItems: "center", color: drag ? C.gold : C.muted, fontSize: "1rem" }}>↑</div><div style={{ fontFamily: fH, fontSize: "1.1rem", marginBottom: 4 }}>Drop statements here</div><div style={{ fontSize: "0.55rem", color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>PDF · CSV · TXT — multiple files supported</div></>}
            <input ref={fRef} type="file" accept=".pdf,.csv,.txt,.tsv" multiple style={{ display: "none" }} onChange={(e) => { if (e.target.files) onFiles(Array.from(e.target.files), uploadType); e.target.value = ""; }} />
          </div>
          {stmts.length === 0 && !busy ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted }}><div style={{ fontSize: "2rem", marginBottom: 12, opacity: 0.3 }}>🏦</div><div style={{ fontFamily: fH, fontSize: "1.2rem", fontWeight: 300, color: C.ink }}>No statements yet</div></div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 20 }}>
              {stmts.map((st) => (
                <div key={st.id} style={{ background: C.card, border: `1px solid ${C.border}`, padding: "16px 18px", borderRadius: 2, animation: "fadeIn 0.3s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 6 }}>
                    <div><div style={{ fontFamily: fH, fontSize: "1rem", fontWeight: 600, marginBottom: 2 }}>{st.bank}</div><div style={{ fontSize: "0.55rem", letterSpacing: "0.08em", color: C.muted, textTransform: "uppercase" }}>{st.name} · {st.size}</div></div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      {(() => {
                        const meta: Record<StatementType, { label: string; color: string }> = {
                          bank: { label: "Bank", color: C.teal },
                          credit: { label: "Credit", color: C.gold },
                          investment: { label: "Invest", color: C.blue },
                        };
                        const m = meta[st.type ?? "bank"];
                        return <span style={{ fontSize: "0.48rem", color: m.color, border: `1px solid ${m.color}55`, padding: "2px 5px", textTransform: "uppercase", letterSpacing: "0.08em" }}>{m.label}</span>;
                      })()}
                      {st.isPdf && <span style={{ fontSize: "0.48rem", color: C.rust, border: `1px solid ${C.rust}40`, padding: "2px 5px", textTransform: "uppercase" }}>PDF</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: "0.6rem", color: st.txnCount > 0 ? C.sage : C.rust, margin: "8px 0 12px" }}>{st.txnCount > 0 ? `${st.txnCount} transactions ✓` : "No transactions parsed"}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button style={{ ...btn, background: "none", color: C.rust, border: "1px solid transparent" }} onClick={() => remove(st.id)}>Remove</button>
                  </div>
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
                const stTxns = txns.filter((t) => t.stmtId === st.id);
                const si = stTxns.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
                const so = stTxns.filter((t) => t.amount < 0).reduce((a, t) => a + Math.abs(t.amount), 0);
                return (
                  <div key={st.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}20`, fontSize: "0.68rem" }}>
                    <div><strong>{st.bank}</strong> <span style={{ color: C.muted, fontSize: "0.55rem" }}>({st.txnCount} txns · {st.name})</span></div>
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
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button style={{ ...btn, background: "none", color: C.gold, border: `1px solid ${C.gold}40`, padding: "9px 24px" }}
                onClick={onRecategorize}>
                Re-categorize
              </button>
              <button style={{ ...btn, background: "none", color: C.sage, border: `1px solid ${C.sage}40`, padding: "9px 24px" }}
                onClick={onExport}>
                Export Backup
              </button>
              <button style={{ ...btn, background: "none", color: C.blue, border: `1px solid ${C.blue}40`, padding: "9px 24px" }}
                onClick={() => importRef.current?.click()}>
                Import Backup
              </button>
              <button style={{ ...btn, background: "none", color: C.rust, border: `1px solid ${C.rust}40`, padding: "9px 24px" }}
                onClick={onClearAll}>
                Clear All Data
              </button>
              <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
            </div>
          </>)}
        </div>)}
      </main>
    </div>
  );
}
