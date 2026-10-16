// DuckDB extensions Blinkql serves from its own origin (ADR-008). DuckDB-wasm doesn't build in
// Parquet or JSON support: it loads them as extensions on first use, by default from
// extensions.duckdb.org, which the Content Security Policy blocks. The build fetches these files,
// checks them against the checksums below, and ships them under EXTENSIONS_PATH
// (src/engine/vite-plugin.ts).
//
// Extensions only load into the DuckDB version they were built for. When @duckdb/duckdb-wasm is
// upgraded, the engine refuses to start until `extensionsVersion` and the checksums are updated.

/** Where the extension repository is served; DuckDB appends `/<version>/<platform>/<file>`. */
export const EXTENSIONS_PATH = "/duckdb-extensions";

/** The DuckDB version the files below were built for. */
export const extensionsVersion = "v1.4.3";

/** SHA-256 of each file, keyed by its path below `<version>/` in DuckDB's repository layout. */
export const extensionChecksums: Readonly<Record<string, string>> = {
  "wasm_eh/parquet.duckdb_extension.wasm":
    "22765c8f7dc741cda2b571a66ac7bb355295d7d69a6c37e5315b265672984f55",
  "wasm_eh/json.duckdb_extension.wasm":
    "b997276c8e15cc3ebdeda340d73d15dc1c4f4755ad281280451cb0a2f79302e9",
  "wasm_mvp/parquet.duckdb_extension.wasm":
    "0785c6c95d003eff4faa7b3b4b660f02c9c92f6d68d135ddf330d42e3a650600",
  "wasm_mvp/json.duckdb_extension.wasm":
    "5771b6d57335eca8e2ba4fdaacb491a53b49577bd7f1b0c39e2cd7a39b4e9313",
};
