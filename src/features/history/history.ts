// The queries that ran (the last HISTORY_LIMIT of them) and the ones the user saved, kept in the
// browser (storage.ts) so they survive a reload. Every run that finishes, fails or is cancelled
// is recorded. Components read this with useSyncExternalStore.
import { getQueryRun, type QueryRun, subscribeToQueryRun } from "@/features/results/query-run";
import { indexedDbStore, type KeyValueStore, memoryStore } from "./storage";

export const HISTORY_LIMIT = 500;

export type HistoryEntry = {
  id: string;
  sql: string;
  /** When the run ended, in milliseconds since the epoch. */
  ranAt: number;
  durationMs: number;
  outcome: "done" | "failed" | "cancelled";
  rowCount?: number;
  error?: string;
};

export type SavedQuery = { id: string; name: string; sql: string; savedAt: number };

export type History = {
  /** Newest first. */
  history: readonly HistoryEntry[];
  /** In the order they were saved. */
  saved: readonly SavedQuery[];
  /** False until they've been read from the store. */
  loaded: boolean;
};

const empty: History = { history: [], saved: [], loaded: false };

let state = empty;
let store: KeyValueStore | null = null;
let started: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();

function update(next: History): void {
  state = next;
  for (const listener of listeners) listener();
}

/** The current history and saved queries. Returns the same object until they change. */
export function getHistory(): History {
  return state;
}

/** Calls `listener` whenever they change; returns a function that unsubscribes. */
export function subscribeToHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `entries` whose SQL contains `query`, ignoring case. A blank query keeps them all. */
export function filterHistory(
  entries: readonly HistoryEntry[],
  query: string,
): readonly HistoryEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => entry.sql.toLowerCase().includes(needle));
}

function record(run: QueryRun): void {
  if (!store || run.state === "idle" || run.state === "running") return;
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    sql: run.sql,
    ranAt: Date.now(),
    durationMs: run.durationMs,
    outcome: run.state,
    ...(run.state === "done" && { rowCount: run.rowCount }),
    ...(run.state === "failed" && { error: run.error.message }),
  };
  const history = [entry, ...state.history];
  const dropped = history.splice(HISTORY_LIMIT).map(({ id }) => id);
  update({ ...state, history });
  void store.put("history", entry);
  if (dropped.length > 0) void store.delete("history", dropped);
}

/**
 * Loads what's stored in `into` (the browser's IndexedDB by default, or memory where it can't be
 * opened, as in some private windows) and starts recording runs. Calling it again does nothing
 * until resetHistory().
 */
export function startHistory(into?: KeyValueStore): Promise<void> {
  started ??= (async () => {
    const opened =
      into ??
      (typeof indexedDB === "undefined"
        ? memoryStore()
        : await indexedDbStore().catch(() => memoryStore()));
    const [history, saved] = await Promise.all([
      opened.getAll<HistoryEntry>("history"),
      opened.getAll<SavedQuery>("saved"),
    ]);
    store = opened;
    update({
      history: history.sort((a, b) => b.ranAt - a.ranAt),
      saved: saved.sort((a, b) => a.savedAt - b.savedAt),
      loaded: true,
    });
    let last = getQueryRun();
    unsubscribe = subscribeToQueryRun(() => {
      const run = getQueryRun();
      if (run === last) return;
      last = run;
      record(run);
    });
  })();
  return started;
}

/** Stops recording and forgets everything in memory (the store keeps it). For tests. */
export function resetHistory(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = null;
  store = null;
  update(empty);
}

/** Saves `sql` under `name`, trimmed. Does nothing for a blank name. */
export async function saveQuery(name: string, sql: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  // Saved before the stored queries were loaded, it would be overwritten by them.
  await started;
  const query: SavedQuery = { id: crypto.randomUUID(), name: trimmed, sql, savedAt: Date.now() };
  update({ ...state, saved: [...state.saved, query] });
  await store?.put("saved", query);
}

/** Renames the saved query `id` to `name`, trimmed. Does nothing for a blank name. */
export async function renameSavedQuery(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  const query = state.saved.find((saved) => saved.id === id);
  if (!trimmed || !query) return;
  const renamed = { ...query, name: trimmed };
  update({ ...state, saved: state.saved.map((saved) => (saved.id === id ? renamed : saved)) });
  await store?.put("saved", renamed);
}

export async function deleteSavedQuery(id: string): Promise<void> {
  update({ ...state, saved: state.saved.filter((saved) => saved.id !== id) });
  await store?.delete("saved", [id]);
}
