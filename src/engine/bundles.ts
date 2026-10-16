// DuckDB-wasm's engine files, served from Blinkql's own origin instead of a CDN (ADR-008).
// Vite copies each file into /assets/ under a content hash, so the exact package version pinned in
// package.json decides what ships, and vercel.json caches /assets/ as immutable.
// Only the single-threaded bundles are listed; the multithreaded one is experiment P-08 (ADR-007).
import type { DuckDBBundles } from "@duckdb/duckdb-wasm";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehModule from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import mvpModule from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";

/** `selectBundle()` picks `eh` when the browser supports WebAssembly exceptions, else `mvp`. */
export const bundles: DuckDBBundles = {
  mvp: { mainModule: mvpModule, mainWorker: mvpWorker },
  eh: { mainModule: ehModule, mainWorker: ehWorker },
};
