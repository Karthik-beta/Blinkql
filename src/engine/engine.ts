// The query engine: DuckDB-wasm running in a Web Worker (ADR-003).
// The engine starts once per page load and is shared by everything that queries it. Results come
// back as Arrow tables, which stay outside React state (ADR-004).
import {
  AsyncDuckDB,
  type AsyncDuckDBConnection,
  selectBundle,
  VoidLogger,
} from "@duckdb/duckdb-wasm";
import type { Table } from "apache-arrow";
import { markOnce, marks } from "@/lib/user-timing";
import { bundles } from "./bundles";

export type EngineStatus =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "ready"; version: string }
  | { state: "failed"; error: Error };

type Engine = {
  db: AsyncDuckDB;
  connection: AsyncDuckDBConnection;
};

let engine: Promise<Engine> | null = null;
let status: EngineStatus = { state: "idle" };
const listeners = new Set<() => void>();

function setStatus(next: EngineStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

/** The engine's current status. Returns the same object until the status changes. */
export function getEngineStatus(): EngineStatus {
  return status;
}

/** Calls `listener` whenever the status changes; returns a function that unsubscribes. */
export function subscribeToEngineStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function boot(): Promise<Engine> {
  const bundle = await selectBundle(bundles);
  if (!bundle.mainWorker) throw new Error("No DuckDB-wasm worker for this browser");

  const worker = new Worker(bundle.mainWorker);
  const db = new AsyncDuckDB(new VoidLogger(), worker);
  try {
    await db.instantiate(bundle.mainModule);
    const connection = await db.connect();
    // Smoke check: the engine counts as ready only once it has answered a query.
    const probe = await connection.query("SELECT 42 AS answer");
    if (probe.getChild("answer")?.get(0) !== 42) {
      throw new Error("The engine started but returned a wrong answer to SELECT 42");
    }
    const version = await db.getVersion();
    markOnce(marks.engineReady);
    setStatus({ state: "ready", version });
    return { db, connection };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

function getEngine(): Promise<Engine> {
  if (!engine) {
    setStatus({ state: "starting" });
    const starting = boot();
    engine = starting;
    starting.catch((error: unknown) => {
      // Forget the failed attempt so the next call can try again.
      if (engine === starting) engine = null;
      setStatus({
        state: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });
  }
  return engine;
}

/** Starts the engine in the background if it isn't running yet. Failures show up in the status. */
export function startEngine(): void {
  getEngine().catch(() => {});
}

/** Runs `sql` and resolves with the result as an Arrow table. Starts the engine if needed. */
export async function query(sql: string): Promise<Table> {
  const { connection } = await getEngine();
  return connection.query(sql);
}

/** Closes the connection and terminates the worker. The next query starts a fresh engine. */
export async function stopEngine(): Promise<void> {
  const running = engine;
  engine = null;
  setStatus({ state: "idle" });
  if (!running) return;
  try {
    const { db, connection } = await running;
    await connection.close();
    await db.terminate();
  } catch {
    // It never started, and boot() already cleaned up after itself.
  }
}
