// The catalog: tables imported from local files or read from the web. Each file is registered with
// the engine, by handle or by URL, and gets a view named after it, so SQL reads the file directly
// (see the Architecture page).
import { query, registerFile, registerUrl, unregisterFile } from "@/engine/engine";
import { parseEngineError } from "@/features/results/engine-error";
import { measureSince, measures } from "@/lib/user-timing";
import { detectFormat, type FileFormat, quoteIdentifier, readerFor, tableNameFor } from "./formats";
import { deviceMemoryGiB, memoryWarning } from "./memory";
import { probeRemoteFile, remoteFileName, remoteReadMessage } from "./remote";

export type ImportedTable = {
  /** The view's name, used in SQL. */
  name: string;
  /** The file's name, or a remote file's full URL. */
  fileName: string;
  format: FileFormat;
  columns: readonly TableColumn[];
  /** The file itself, or its URL, kept so it can be imported again into a restarted engine. */
  source: File | URL;
};

export type TableColumn = {
  name: string;
  /** DuckDB's name for the column's type, such as VARCHAR. */
  type: string;
};

export type ImportFailure = {
  fileName: string;
  message: string;
};

export type Catalog = {
  tables: readonly ImportedTable[];
  /** Names of files still being imported. */
  importing: readonly string[];
  /** Files from the most recent import that couldn't be imported. */
  failures: readonly ImportFailure[];
  /** Files from the most recent import that were imported but may not fit in memory or be slow. */
  warnings: readonly ImportFailure[];
};

let catalog: Catalog = { tables: [], importing: [], failures: [], warnings: [] };
/** Table names in use or claimed by an import in progress, so concurrent imports can't clash. */
const takenNames = new Set<string>();
const listeners = new Set<() => void>();

function update(change: (current: Catalog) => Catalog): void {
  catalog = change(catalog);
  for (const listener of listeners) listener();
}

/** The current catalog. Returns the same object until something changes. */
export function getCatalog(): Catalog {
  return catalog;
}

/** Calls `listener` whenever the catalog changes; returns a function that unsubscribes. */
export function subscribeToCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function displayName(source: File | URL): string {
  return source instanceof URL ? source.href : source.name;
}

async function importFile(source: File | URL): Promise<ImportedTable> {
  const fileName = source instanceof URL ? remoteFileName(source) : source.name;
  const format = detectFormat(fileName);
  if (!format) throw new Error("Not a CSV, TSV, Parquet, JSON or JSON Lines file");
  if (source instanceof URL) {
    const warning = await probeRemoteFile(source);
    if (warning) {
      const warned = { fileName: source.href, message: warning };
      update((current) => ({ ...current, warnings: [...current.warnings, warned] }));
    }
  }

  const name = tableNameFor(fileName, takenNames);
  takenNames.add(name);
  // Registered under the table name, so two files called data.csv in different folders can't clash.
  const path = `${name}.${format}`;
  const started = performance.now();
  try {
    if (source instanceof URL) await registerUrl(path, source.href);
    else await registerFile(path, source);
    // Creating the view reads the schema, so an unreadable file fails here rather than later.
    await query(`CREATE VIEW ${quoteIdentifier(name)} AS SELECT * FROM ${readerFor(format, path)}`);
    const columns = (await query(`DESCRIBE ${quoteIdentifier(name)}`))
      .toArray()
      .map((row) => ({ name: String(row.column_name), type: String(row.column_type) }));
    measureSince(measures.import, started);
    return { name, fileName: displayName(source), format, columns, source };
  } catch (error) {
    await query(`DROP VIEW IF EXISTS ${quoteIdentifier(name)}`).catch(() => {});
    await unregisterFile(path).catch(() => {});
    takenNames.delete(name);
    throw error;
  }
}

/** One row per column of `table`: its type, min and max, distinct count, quartiles and null %. */
export function profileSql(table: string): string {
  return `SUMMARIZE ${quoteIdentifier(table)}`;
}

/** The query that shows every row of `table`. */
export function rowsSql(table: string): string {
  return `SELECT * FROM ${quoteIdentifier(table)}`;
}

/** Imports each file, local or on the web, as a table, one at a time and in order. */
export async function importFiles(files: readonly (File | URL)[]): Promise<void> {
  if (files.length === 0) return;
  update((current) => ({
    ...current,
    importing: [...current.importing, ...files.map(displayName)],
    failures: [],
    warnings: [],
  }));

  for (const file of files) {
    const fileName = displayName(file);
    try {
      const table = await importFile(file);
      const warning =
        file instanceof URL
          ? null
          : memoryWarning(file.size, { deviceMemoryGiB: deviceMemoryGiB() });
      update((current) => ({
        ...current,
        tables: [...current.tables, table],
        warnings: warning
          ? [...current.warnings, { fileName, message: warning }]
          : current.warnings,
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? remoteReadMessage(parseEngineError(error, "", { preservePlainText: true }).message)
          : String(error);
      update((current) => ({
        ...current,
        failures: [...current.failures, { fileName, message }],
      }));
    } finally {
      update((current) => {
        const index = current.importing.indexOf(fileName);
        return { ...current, importing: current.importing.toSpliced(index, 1) };
      });
    }
  }
}

/** Reads the file at `url` as a table. The engine fetches only the parts of it a query needs. */
export function importUrl(url: URL): Promise<void> {
  return importFiles([url]);
}

/**
 * Imports every table's file again, e.g. into a restarted engine, which starts with none. Files are
 * imported in the same order, so each table gets its old name back.
 */
export async function reimportTables(): Promise<void> {
  const files = catalog.tables.map((table) => table.source);
  takenNames.clear();
  update((current) => ({ ...current, tables: [], failures: [], warnings: [] }));
  await importFiles(files);
}

/** Empties the catalog. For tests; it doesn't drop anything from the engine. */
export function resetCatalog(): void {
  takenNames.clear();
  update(() => ({ tables: [], importing: [], failures: [], warnings: [] }));
}
