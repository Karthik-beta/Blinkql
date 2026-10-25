import { Dictionary, Uint8, Utf8 } from "apache-arrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marks } from "@/lib/user-timing";
import {
  getEngineStatus,
  query,
  registerFile,
  restartEngine,
  startEngine,
  stopEngine,
  streamQuery,
  subscribeToEngineStatus,
  unregisterFile,
} from "./engine";
import { EngineCrashedError } from "./errors";

// DuckDB-wasm needs a real Web Worker and WebAssembly, which jsdom doesn't have. These tests cover
// the lifecycle around it; e2e/engine.spec.ts runs the real engine in real browsers.
const duckdb = vi.hoisted(() => {
  const answer = { getChild: () => ({ get: () => 42 }) };
  /** An Arrow stream reader of `batches`, each a promise so a test can hold one back. */
  const reader = (batches: Promise<unknown>[]) => ({
    schema: { fields: [] },
    open: vi.fn(async () => {}),
    next: vi.fn(async () => {
      const batch = batches.shift();
      return batch ? { done: false, value: await batch } : { done: true, value: null };
    }),
  });
  const connection = {
    query: vi.fn(async (_sql: string): Promise<unknown> => answer),
    send: vi.fn(
      async (_sql: string, _allowStreamResult?: boolean): Promise<unknown> =>
        reader([Promise.resolve("batch 1"), Promise.resolve("batch 2")]),
    ),
    close: vi.fn(async () => {}),
    cancelSent: vi.fn(async () => true),
  };
  const db = {
    instantiate: vi.fn(async (_url: string) => null),
    connect: vi.fn(async () => connection),
    getVersion: vi.fn(async () => "v1.4.3"),
    terminate: vi.fn(async () => {}),
    registerFileHandle: vi.fn(async () => {}),
    dropFile: vi.fn(async () => null),
  };
  return {
    answer,
    reader,
    connection,
    db,
    module: {
      selectBundle: vi.fn(async () => ({
        mainModule: "/assets/duckdb-eh.wasm",
        mainWorker: "/assets/duckdb-browser-eh.worker.js",
        pthreadWorker: null,
      })),
      AsyncDuckDB: vi.fn(function AsyncDuckDB() {
        return db;
      }),
      VoidLogger: vi.fn(),
      DuckDBDataProtocol: { BROWSER_FILEREADER: 2 },
    },
  };
});
vi.mock("@duckdb/duckdb-wasm", () => duckdb.module);
vi.mock("./bundles", () => ({ bundles: {} }));
vi.mock("./extensions", () => ({
  EXTENSIONS_PATH: "/duckdb-extensions",
  extensionsVersion: "v1.4.3",
}));

type FakeWorker = {
  url: string;
  terminate: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, listener: (event: { message: string }) => void) => void;
  /** Fires the worker's error event, the way a crashed worker does. */
  crash: (message: string) => void;
};
const workers: FakeWorker[] = [];

/** Resolves once the engine leaves the "starting" state. */
function settled() {
  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeToEngineStatus(() => {
      if (getEngineStatus().state !== "starting") {
        unsubscribe();
        resolve();
      }
    });
  });
}

describe("engine", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "Worker",
      vi.fn(function Worker(url: string) {
        const errorListeners: ((event: { message: string }) => void)[] = [];
        const worker: FakeWorker = {
          url,
          terminate: vi.fn(),
          addEventListener: (type, listener) => {
            if (type === "error") errorListeners.push(listener);
          },
          crash: (message) => {
            for (const listener of errorListeners) listener({ message });
          },
        };
        workers.push(worker);
        return worker;
      }),
    );
  });

  afterEach(async () => {
    await stopEngine();
    workers.length = 0;
    performance.clearMarks();
  });

  it("starts DuckDB in a worker and reports the version", async () => {
    startEngine();
    expect(getEngineStatus()).toEqual({ state: "starting" });
    await settled();

    expect(workers.map((w) => w.url)).toEqual(["/assets/duckdb-browser-eh.worker.js"]);
    expect(duckdb.db.instantiate).toHaveBeenCalledWith("/assets/duckdb-eh.wasm");
    expect(getEngineStatus()).toEqual({ state: "ready", version: "v1.4.3" });
    expect(performance.getEntriesByName(marks.engineReady, "mark")).toHaveLength(1);
  });

  it("loads extensions from our own origin", async () => {
    await query("SELECT 1");

    expect(duckdb.connection.query).toHaveBeenCalledWith(
      `SET custom_extension_repository = '${location.origin}/duckdb-extensions'`,
    );
  });

  it("refuses to start a DuckDB version the self-hosted extensions weren't built for", async () => {
    duckdb.db.getVersion.mockResolvedValueOnce("v1.5.0");

    await expect(query("SELECT 1")).rejects.toThrow("which are for v1.4.3");
    expect(getEngineStatus()).toMatchObject({ state: "failed" });
  });

  it("registers files by handle, read on demand", async () => {
    const file = new File(["a,b"], "data.csv");
    await registerFile("data.csv", file);
    await unregisterFile("data.csv");

    expect(duckdb.db.registerFileHandle).toHaveBeenCalledWith("data.csv", file, 2, true);
    expect(duckdb.db.dropFile).toHaveBeenCalledWith("data.csv");
  });

  it("starts only one engine however often it's asked", async () => {
    startEngine();
    startEngine();
    await query("SELECT 1");

    expect(workers).toHaveLength(1);
  });

  it("runs queries on the shared connection and returns the Arrow table", async () => {
    const table = { numRows: 1 };
    duckdb.connection.query
      .mockResolvedValueOnce(undefined) // SET custom_extension_repository
      .mockResolvedValueOnce(undefined) // SET errors_as_json
      .mockResolvedValueOnce(duckdb.answer)
      .mockResolvedValueOnce(table);

    await expect(query("SELECT 42")).resolves.toBe(table);
    expect(duckdb.connection.query).toHaveBeenLastCalledWith("SELECT 42");
  });

  it("reports a failed start, cleans up and can try again", async () => {
    duckdb.db.instantiate.mockRejectedValueOnce(new Error("wasm failed to compile"));

    await expect(query("SELECT 1")).rejects.toThrow("wasm failed to compile");
    expect(getEngineStatus()).toMatchObject({ state: "failed" });
    expect(workers[0]?.terminate).toHaveBeenCalled();

    await query("SELECT 1");
    expect(getEngineStatus()).toMatchObject({ state: "ready" });
    expect(workers).toHaveLength(2);
  });

  it("refuses to report ready if the smoke query gives a wrong answer", async () => {
    duckdb.connection.query
      .mockResolvedValueOnce(undefined) // SET custom_extension_repository
      .mockResolvedValueOnce(undefined) // SET errors_as_json
      .mockResolvedValueOnce({ getChild: () => ({ get: () => 41 }) });

    await expect(query("SELECT 1")).rejects.toThrow("wrong answer to SELECT 42");
    expect(getEngineStatus()).toMatchObject({ state: "failed" });
  });

  it("closes the connection and the worker when stopped", async () => {
    await query("SELECT 1");
    await stopEngine();

    expect(duckdb.connection.close).toHaveBeenCalled();
    expect(duckdb.db.terminate).toHaveBeenCalled();
    expect(getEngineStatus()).toEqual({ state: "idle" });
  });

  it("turns on JSON errors, so they carry a position and suggestions", async () => {
    await query("SELECT 1");
    expect(duckdb.connection.query).toHaveBeenCalledWith("SET errors_as_json = true");
  });

  it("fails a query in flight when the worker crashes, instead of waiting forever", async () => {
    await query("SELECT 1");
    duckdb.connection.query.mockReturnValueOnce(new Promise(() => {}));

    const running = query("SELECT * FROM big");
    await Promise.resolve();
    workers[0]?.crash("out of memory");

    await expect(running).rejects.toThrow(EngineCrashedError);
    expect(getEngineStatus()).toMatchObject({
      state: "crashed",
      error: { message: "out of memory" },
    });
  });

  it("reports a crash straight away, even with no query running", async () => {
    await query("SELECT 1");
    workers[0]?.crash("worker died");

    expect(getEngineStatus()).toMatchObject({ state: "crashed" });
  });

  it("treats a WebAssembly trap as a crash", async () => {
    await query("SELECT 1");
    const trap = new Error("memory access out of bounds");
    trap.name = "RuntimeError";
    duckdb.connection.query.mockRejectedValueOnce(trap);

    await expect(query("SELECT 2")).rejects.toThrow(EngineCrashedError);
    expect(getEngineStatus()).toMatchObject({ state: "crashed" });
  });

  it("passes ordinary SQL errors through without calling them crashes", async () => {
    await query("SELECT 1");
    duckdb.connection.query.mockRejectedValueOnce(new Error("Parser Error: syntax error"));

    await expect(query("SELEC 1")).rejects.toThrow("Parser Error: syntax error");
    expect(getEngineStatus()).toMatchObject({ state: "ready" });
  });

  it("refuses queries and files once crashed, until restarted", async () => {
    await query("SELECT 1");
    workers[0]?.crash("worker died");
    duckdb.connection.query.mockClear();

    await expect(query("SELECT 2")).rejects.toThrow(EngineCrashedError);
    await expect(registerFile("a.csv", new File([""], "a.csv"))).rejects.toThrow(
      EngineCrashedError,
    );
    expect(duckdb.connection.query).not.toHaveBeenCalled();

    await restartEngine();
    expect(getEngineStatus()).toMatchObject({ state: "ready" });
    expect(workers).toHaveLength(2);
    await expect(query("SELECT 3")).resolves.toBeDefined();
  });

  it("doesn't wait for a crashed worker to close the connection", async () => {
    await query("SELECT 1");
    workers[0]?.crash("worker died");
    await stopEngine();

    expect(duckdb.connection.close).not.toHaveBeenCalled();
    expect(duckdb.db.terminate).toHaveBeenCalled();
  });

  describe("streaming", () => {
    /** Reads every batch of `sql`'s result. */
    async function readAll(sql: string): Promise<unknown[]> {
      const { batches } = await streamQuery(sql);
      const read: unknown[] = [];
      for await (const batch of batches) read.push(batch);
      return read;
    }

    it("streams a result's batches as the engine produces them", async () => {
      await expect(readAll("SELECT * FROM big")).resolves.toEqual(["batch 1", "batch 2"]);
      expect(duckdb.connection.send).toHaveBeenCalledWith("SELECT * FROM big", true);
    });

    it("keeps other queries waiting until the stream's last batch has been read", async () => {
      await query("SELECT 1");
      let release!: (batch: unknown) => void;
      duckdb.connection.send.mockResolvedValueOnce(
        duckdb.reader([new Promise((resolve) => (release = resolve))]),
      );
      const streaming = readAll("SELECT * FROM big");
      await vi.waitFor(() => expect(duckdb.connection.send).toHaveBeenCalled());

      const waiting = query("SELECT 2");
      await new Promise((resolve) => setTimeout(resolve));
      expect(duckdb.connection.query).not.toHaveBeenCalledWith("SELECT 2");

      release("batch 1");
      await expect(streaming).resolves.toEqual(["batch 1"]);
      await waiting;
      expect(duckdb.connection.query).toHaveBeenLastCalledWith("SELECT 2");
    });

    it("runs anything but a single read whole, so it never runs twice", async () => {
      const table = { schema: "schema", batches: ["inserted"] };
      await query("SELECT 1");
      duckdb.connection.query.mockResolvedValueOnce(table);

      await expect(readAll("INSERT INTO t VALUES (1) RETURNING *")).resolves.toEqual(["inserted"]);
      expect(duckdb.connection.send).not.toHaveBeenCalled();
    });

    it("runs a result with dictionary-encoded columns again whole, as streaming loses them", async () => {
      const enumField = { type: new Dictionary(new Utf8(), new Uint8()) };
      duckdb.connection.send.mockResolvedValueOnce({
        ...duckdb.reader([]),
        schema: { fields: [enumField] },
      });
      await query("SELECT 1");
      duckdb.connection.query.mockResolvedValueOnce({ schema: "schema", batches: ["with enums"] });

      await expect(readAll("SELECT 'b'::ENUM('a', 'b')")).resolves.toEqual(["with enums"]);
      expect(duckdb.connection.query).toHaveBeenLastCalledWith("SELECT 'b'::ENUM('a', 'b')");
    });

    it("unwraps a streamed error's JSON, as query() would have thrown it", async () => {
      const inner =
        '{"exception_type":"Parser","exception_message":"syntax error at or near \\"SELEC\\""}';
      duckdb.connection.send.mockRejectedValueOnce(
        new Error(JSON.stringify({ exception_type: "Parser", exception_message: inner })),
      );

      await expect(streamQuery("SELECT * FROM t WHERE")).rejects.toThrow(new Error(inner));
    });

    it("gives the connection back when the reader stops early", async () => {
      const { batches } = await streamQuery("SELECT * FROM big");
      for await (const _ of batches) break;

      await expect(query("SELECT 2")).resolves.toBeDefined();
    });

    it("gives the connection back when the query fails", async () => {
      await query("SELECT 1");
      duckdb.connection.send.mockRejectedValueOnce(new Error("Binder Error: no such column"));

      await expect(streamQuery("SELECT nope")).rejects.toThrow("Binder Error");
      await expect(query("SELECT 2")).resolves.toBeDefined();
    });

    it("cancels the query when its signal aborts, and gives the connection back", async () => {
      let cancelled!: (error: Error) => void;
      duckdb.connection.send.mockResolvedValueOnce(
        duckdb.reader([
          Promise.resolve("batch 1"),
          new Promise((_, reject) => (cancelled = reject)),
        ]),
      );
      duckdb.connection.cancelSent.mockImplementationOnce(async () => {
        cancelled(new Error("query was canceled"));
        return true;
      });
      const controller = new AbortController();
      const { batches } = await streamQuery("SELECT * FROM big", controller.signal);
      const reader = batches[Symbol.asyncIterator]();
      await expect(reader.next()).resolves.toEqual({ done: false, value: "batch 1" });
      const next = reader.next();
      controller.abort();

      await expect(next).rejects.toThrow("query was canceled");
      expect(duckdb.connection.cancelSent).toHaveBeenCalledTimes(1);
      await expect(query("SELECT 2")).resolves.toBeDefined();
    });

    it("doesn't send a query cancelled while it waited for the connection", async () => {
      await query("SELECT 1");
      const controller = new AbortController();
      controller.abort();

      await expect(streamQuery("SELECT * FROM big", controller.signal)).rejects.toThrow(
        expect.objectContaining({ name: "AbortError" }),
      );
      expect(duckdb.connection.send).not.toHaveBeenCalled();
      await expect(query("SELECT 2")).resolves.toBeDefined();
    });

    it("reads no more batches once its signal has aborted", async () => {
      const controller = new AbortController();
      const { batches } = await streamQuery("SELECT * FROM big", controller.signal);
      controller.abort();
      const read: unknown[] = [];
      for await (const batch of batches) read.push(batch);

      expect(read).toEqual([]);
      await expect(query("SELECT 2")).resolves.toBeDefined();
    });

    it("fails the stream when the worker crashes before its next batch", async () => {
      duckdb.connection.send.mockResolvedValueOnce(
        duckdb.reader([Promise.resolve("batch 1"), new Promise(() => {})]),
      );
      const streaming = readAll("SELECT * FROM big");
      await vi.waitFor(() => expect(duckdb.connection.send).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve));
      workers[0]?.crash("out of memory");

      await expect(streaming).rejects.toThrow(EngineCrashedError);
      expect(getEngineStatus()).toMatchObject({ state: "crashed" });
    });
  });

  it("fails to start, rather than waiting forever, if the worker dies while starting", async () => {
    duckdb.db.instantiate.mockReturnValueOnce(new Promise(() => {}));

    const starting = query("SELECT 1");
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]?.crash("Worker load was blocked by Cross-Origin-Embedder-Policy");

    await expect(starting).rejects.toThrow("blocked by Cross-Origin-Embedder-Policy");
    expect(getEngineStatus()).toMatchObject({ state: "failed" });
  });
});
