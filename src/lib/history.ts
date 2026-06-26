import { load, type Store } from "@tauri-apps/plugin-store";
import type { HistoryEntry, ScanResult, ScanSource } from "./types";

const MAX_ENTRIES = 500;

// Lazy singleton so we never top-level await (keeps tsconfig targets happy).
let storePromise: Promise<Store> | null = null;
function store(): Promise<Store> {
  return (storePromise ??= load("history.json", { autoSave: true, defaults: {} }));
}

async function read(s: Store): Promise<HistoryEntry[]> {
  return (await s.get<HistoryEntry[]>("entries")) ?? [];
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return read(await store());
}

export async function saveHistory(
  results: ScanResult[],
  source: ScanSource,
  fileName?: string,
): Promise<HistoryEntry[]> {
  const s = await store();
  const list = await read(s);
  const stamped: HistoryEntry[] = results.map((r) => ({
    ...r,
    id: crypto.randomUUID(),
    source,
    at: Date.now(),
    fileName,
  }));
  const next = [...stamped, ...list].slice(0, MAX_ENTRIES);
  await s.set("entries", next);
  return next;
}

/** Save many files' results in one write (batch / folder scans). */
export async function saveHistoryBatch(
  scans: { results: ScanResult[]; fileName: string }[],
  source: ScanSource,
): Promise<HistoryEntry[]> {
  const s = await store();
  const list = await read(s);
  const at = Date.now();
  const stamped: HistoryEntry[] = [];
  for (const sc of scans) {
    for (const r of sc.results) {
      stamped.push({ ...r, id: crypto.randomUUID(), source, at, fileName: sc.fileName });
    }
  }
  const next = [...stamped, ...list].slice(0, MAX_ENTRIES);
  await s.set("entries", next);
  return next;
}

export async function deleteHistory(id: string): Promise<HistoryEntry[]> {
  const s = await store();
  const next = (await read(s)).filter((e) => e.id !== id);
  await s.set("entries", next);
  return next;
}

export async function clearHistory(): Promise<void> {
  const s = await store();
  await s.set("entries", []);
}
