// The query engine: DuckDB-wasm running in a Web Worker (ADR-003).
// The engine starts once per page load and is shared by everything that queries it. Results come
// back as Arrow tables or streams of record batches, which stay outside React state (ADR-004).
import {
  AsyncDuckDB,
  type AsyncDuckDBConnection,
  DuckDBDataProtocol,
  selectBundle,
  VoidLogger,
} from "@duckdb/duckdb-wasm";
import { DataType, type Field, type RecordBatch, type Schema, type Table } from "apache-arrow";
import { markOnce, marks } from "@/lib/user-timing";
import { bundles } from "./bundles";
import { EngineCrashedError } from "./errors";
import { EXTENSIONS_PATH, extensionsVersion } from "./extensions";
import { isSingleRead } from "./read-only";

export type EngineStatus =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "ready"; version: string }
  | { state: "failed"; error: Error }
  /** It was running and then died. It refuses queries until restarted (see restartEngine). */
  | { state: "crashed"; error: EngineCrashedError };

type Engine = {
  db: AsyncDuckDB;
  connection: AsyncDuckDBConnection;
  /** Rejects when the worker dies. */
  crashed: Promise<never>;
  /**
   * Waits until no other query is using the connection and takes it; the function it resolves
   * with gives it back. A result being streamed holds the connection until its last batch, since
   * DuckDB closes a streaming result as soon as the connection runs another query.
   */
  takeConnection: () => Promise<() => void>;
};

/** A query's result, arriving a record batch at a time (see streamQuery). */
export type ResultStream = {
  schema: Schema;
  /** The result's record batches in order, each as soon as the engine has produced it. */
  batches: AsyncIterable<RecordBatch>;
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
  // DuckDB-wasm drops its pending requests when the worker dies without settling them, so a
  // query in flight would wait forever. This fails it instead.
  const crashed = new Promise<never>((_, reject) => {
    worker.addEventListener("error", (event) => {
      const error = new EngineCrashedError(event.message || "The engine's worker stopped");
      // Reported straight away, so the status bar offers a restart even with no query running.
      if (status.state === "ready") crash(error);
      reject(error);
    });
  });
  crashed.catch(() => {});
  /** Fails `step` if the worker dies first; start-up would otherwise wait on it forever. */
  const unlessCrashed = <T>(step: Promise<T>) => Promise.race([step, crashed]);
  const db = new AsyncDuckDB(new VoidLogger(), worker);
  try {
    await unlessCrashed(db.instantiate(bundle.mainModule));
    const version = await unlessCrashed(db.getVersion());
    if (version !== extensionsVersion) {
      throw new Error(
        `DuckDB ${version} can't load the self-hosted extensions, which are for ${extensionsVersion} (see src/engine/extensions.ts)`,
      );
    }
    const connection = await unlessCrashed(db.connect());
    // Load extensions (Parquet, JSON) from our own origin instead of extensions.duckdb.org.
    const repository = new URL(EXTENSIONS_PATH, location.href).href;
    await unlessCrashed(connection.query(`SET custom_extension_repository = '${repository}'`));
    // Errors as JSON carry the error type, its position in the SQL and suggested names, which
    // src/features/results/engine-error.ts turns into readable messages.
    await unlessCrashed(connection.query("SET errors_as_json = true"));
    // Smoke check: the engine counts as ready only once it has answered a query.
    const probe = await unlessCrashed(connection.query("SELECT 42 AS answer"));
    if (probe.getChild("answer")?.get(0) !== 42) {
      throw new Error("The engine started but returned a wrong answer to SELECT 42");
    }
    markOnce(marks.engineReady);
    setStatus({ state: "ready", version });
    return { db, connection, crashed, takeConnection: connectionQueue() };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

/** Hands out a connection to one query at a time, in the order they asked for it. */
function connectionQueue(): Engine["takeConnection"] {
  let free = Promise.resolve();
  return () => {
    let giveBack = () => {};
    const given = new Promise<void>((resolve) => {
      giveBack = resolve;
    });
    const taken = free.then(() => giveBack);
    free = free.then(() => given);
    return taken;
  };
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

/** WebAssembly traps leave DuckDB's memory in an unknown state, so they count as crashes. */
function isCrash(error: unknown): boolean {
  return (
    error instanceof EngineCrashedError ||
    (error instanceof Error &&
      (error.name === "RuntimeError" ||
        /^(unreachable|memory access out of bounds|null function|Aborted\()/.test(error.message)))
  );
}

function crash(error: unknown): EngineCrashedError {
  const crashError =
    error instanceof EngineCrashedError
      ? error
      : new EngineCrashedError(error instanceof Error ? error.message : String(error));
  if (status.state !== "crashed") setStatus({ state: "crashed", error: crashError });
  return crashError;
}

/**
 * Runs `sql` and resolves with the result as an Arrow table. Starts the engine if needed.
 * Rejects with an EngineCrashedError if the engine has crashed or crashes while running it.
 */
export async function query(sql: string): Promise<Table> {
  if (status.state === "crashed") throw status.error;
  const { connection, crashed, takeConnection } = await getEngine();
  const giveBack = await takeConnection();
  try {
    return await Promise.race([connection.query(sql), crashed]);
  } catch (error) {
    throw isCrash(error) ? crash(error) : error;
  } finally {
    giveBack();
  }
}

/**
 * Runs `sql` and resolves with its result's schema as soon as the engine has one, then streams
 * the result a record batch at a time, so its first rows can be shown before the last are computed
 * (P-05). Starts the engine if needed.
 *
 * Only a single statement that only reads is streamed. Anything else, such as an INSERT or several
 * statements, comes back whole, as from query(), but through the same stream: DuckDB-wasm streams
 * results without their dictionaries, so a result with a dictionary-encoded column (an ENUM, say)
 * is run a second time, whole, which must change nothing.
 *
 * The stream holds the connection, so other queries wait, until its last batch has been read or
 * the reader stops early. It rejects with an EngineCrashedError if the engine has crashed or
 * crashes while running it.
 */
export async function streamQuery(sql: string): Promise<ResultStream> {
  if (status.state === "crashed") throw status.error;
  const { connection, crashed, takeConnection } = await getEngine();
  const unlessCrashed = <T>(step: Promise<T>) => Promise.race([step, crashed]);
  const giveBack = await takeConnection();
  /** The whole result, run with query(), as a stream. */
  const whole = async (): Promise<ResultStream> => {
    const table = await unlessCrashed(connection.query(sql));
    async function* batches(): AsyncGenerator<RecordBatch> {
      try {
        yield* table.batches;
      } finally {
        giveBack();
      }
    }
    return { schema: table.schema, batches: batches() };
  };
  try {
    if (!isSingleRead(sql)) return await whole();
    // Allowing a streaming result lets DuckDB hand over each batch as its pipeline produces it,
    // rather than computing the whole result first.
    const reader = await unlessCrashed(connection.send(sql, true));
    await unlessCrashed(reader.open());
    // Streamed, its dictionaries would be missing. Running it again also closes this stream.
    if (reader.schema.fields.some(hasDictionary)) return await whole();
    async function* batches(): AsyncGenerator<RecordBatch> {
      try {
        while (true) {
          const next = await unlessCrashed(reader.next());
          if (next.done) return;
          yield next.value;
        }
      } catch (error) {
        throw isCrash(error) ? crash(error) : unwrapped(error);
      } finally {
        giveBack();
      }
    }
    return { schema: reader.schema, batches: batches() };
  } catch (error) {
    giveBack();
    throw isCrash(error) ? crash(error) : unwrapped(error);
  }
}

/**
 * `error` as query() would have thrown it. A streamed query's error comes as DuckDB's error JSON
 * wrapped in another, whose message is the original JSON; this unwraps it.
 */
function unwrapped(error: unknown): unknown {
  if (!(error instanceof Error) || !error.message.startsWith("{")) return error;
  try {
    const outer: unknown = JSON.parse(error.message);
    const inner =
      typeof outer === "object" && outer !== null && "exception_message" in outer
        ? outer.exception_message
        : undefined;
    return typeof inner === "string" && inner.startsWith("{") ? new Error(inner) : error;
  } catch {
    return error;
  }
}

/** Whether `field`, or a field inside it, is dictionary-encoded. */
function hasDictionary(field: Field): boolean {
  return DataType.isDictionary(field.type) || (field.type.children ?? []).some(hasDictionary);
}

/**
 * Makes a local file readable by SQL under `name`, e.g. `read_csv('name')`. The engine reads
 * slices of the file on demand instead of copying the whole file into memory first.
 */
export async function registerFile(name: string, file: File): Promise<void> {
  if (status.state === "crashed") throw status.error;
  const { db } = await getEngine();
  await db.registerFileHandle(name, file, DuckDBDataProtocol.BROWSER_FILEREADER, true);
}

/** Forgets a file registered with `registerFile()`. */
export async function unregisterFile(name: string): Promise<void> {
  if (status.state === "crashed") throw status.error;
  const { db } = await getEngine();
  await db.dropFile(name);
}

/** Closes the connection and terminates the worker. The next query starts a fresh engine. */
export async function stopEngine(): Promise<void> {
  const running = engine;
  const hasCrashed = status.state === "crashed";
  engine = null;
  setStatus({ state: "idle" });
  if (!running) return;
  try {
    const { db, connection } = await running;
    // A crashed worker would never answer, so don't wait for it to close the connection.
    if (!hasCrashed) await connection.close();
    await db.terminate();
  } catch {
    // It never started, and boot() already cleaned up after itself.
  }
}

/** Replaces the engine with a fresh one, e.g. after a crash. Tables have to be imported again. */
export async function restartEngine(): Promise<void> {
  await stopEngine();
  await getEngine();
}
