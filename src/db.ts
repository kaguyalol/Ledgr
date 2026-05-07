const DB_NAME = "ledgr";
const DB_VERSION = 1;
const STORE_STMTS = "statements";
const STORE_TXNS = "transactions";

export type StatementType = "bank" | "credit" | "investment";

export interface DbStatement {
  id: string;
  name: string;
  bank: string;
  date: string;
  size: string;
  txnCount: number;
  isPdf: boolean;
  type: StatementType;
}

export interface DbTransaction {
  id?: number;
  stmtId: string;
  date: string;
  description: string;
  amount: number;
  category: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STMTS)) {
        db.createObjectStore(STORE_STMTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_TXNS)) {
        const txnStore = db.createObjectStore(STORE_TXNS, {
          keyPath: "id",
          autoIncrement: true,
        });
        txnStore.createIndex("stmtId", "stmtId", { unique: false });
      }
    };
  });
  return dbPromise;
}

export async function addStatement(
  stmt: DbStatement,
  txns: Omit<DbTransaction, "id">[]
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STMTS, STORE_TXNS], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_STMTS).put(stmt);
    const txnStore = tx.objectStore(STORE_TXNS);
    for (const t of txns) txnStore.add(t);
  });
}

export async function getAllStatements(): Promise<DbStatement[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_STMTS).objectStore(STORE_STMTS).getAll();
    req.onsuccess = () => resolve(req.result as DbStatement[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllTransactions(): Promise<DbTransaction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_TXNS).objectStore(STORE_TXNS).getAll();
    req.onsuccess = () => resolve(req.result as DbTransaction[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteStatement(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STMTS, STORE_TXNS], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_STMTS).delete(id);
    const cur = tx.objectStore(STORE_TXNS).index("stmtId").openCursor(IDBKeyRange.only(id));
    cur.onsuccess = () => {
      const c = cur.result;
      if (c) {
        c.delete();
        c.continue();
      }
    };
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STMTS, STORE_TXNS], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_STMTS).clear();
    tx.objectStore(STORE_TXNS).clear();
  });
}

export async function updateTransactionCategories(
  updates: { id: number; category: string }[]
): Promise<void> {
  if (!updates.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TXNS, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE_TXNS);
    for (const u of updates) {
      const getReq = store.get(u.id);
      getReq.onsuccess = () => {
        const t = getReq.result as DbTransaction | undefined;
        if (t) store.put({ ...t, category: u.category });
      };
    }
  });
}

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  statements: DbStatement[];
  transactions: DbTransaction[];
}

export async function exportData(): Promise<BackupPayload> {
  const [statements, transactions] = await Promise.all([
    getAllStatements(),
    getAllTransactions(),
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    statements,
    transactions,
  };
}

export async function importData(payload: BackupPayload): Promise<void> {
  if (!payload || !Array.isArray(payload.statements) || !Array.isArray(payload.transactions)) {
    throw new Error("Invalid backup file: missing statements or transactions");
  }
  await clearAll();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STMTS, STORE_TXNS], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const sStore = tx.objectStore(STORE_STMTS);
    const tStore = tx.objectStore(STORE_TXNS);
    for (const s of payload.statements) sStore.put(s);
    for (const t of payload.transactions) {
      const { id: _drop, ...rest } = t;
      tStore.add(rest);
    }
  });
}
