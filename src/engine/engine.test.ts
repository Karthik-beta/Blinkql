import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marks } from "@/lib/user-timing";
import {
  getEngineStatus,
  query,
  registerFile,
  startEngine,
  stopEngine,
  subscribeToEngineStatus,
  unregisterFile,
} from "./engine";

// DuckDB-wasm needs a real Web Worker and WebAssembly, which jsdom doesn't have. These tests cover
// the lifecycle around it; e2e/engine.spec.ts runs the real engine in real browsers.
const duckdb = vi.hoisted(() => {
  const answer = { getChild: () => ({ get: () => 42 }) };
  const connection = {
    query: vi.fn(async (_sql: string): Promise<unknown> => answer),
    close: vi.fn(async () => {}),
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

const workers: { url: string; terminate: ReturnType<typeof vi.fn> }[] = [];

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
        const worker = { url, terminate: vi.fn() };
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
});
