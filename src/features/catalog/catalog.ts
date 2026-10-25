// The catalog: tables imported from local files. Each file is registered with the engine by handle
// and gets a view named after it, so SQL reads the file directly (see the Architecture page).
import { query, registerFile, unregisterFile } from "@/engine/engine";
import { parseEngineError } from "@/features/results/engine-error";
import { measureSince, measures } from "@/lib/user-timing";
import { detectFormat, type FileFormat, quoteIdentifier, readerFor, tableNameFor } from "./formats";

export type ImportedTable = {
  /** The view's name, used in SQL. */
  name: string;
  fileName: string;
  format: FileFormat;
  columnCount: number;
  /** The file itself, kept so it can be imported again into a restarted engine. */
  file: File;
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
};

let catalog: Catalog = { tables: [], importing: [], failures: [] };
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

async function importFile(file: File): Promise<ImportedTable> {
  const format = detectFormat(file.name);
  if (!format) throw new Error("Not a CSV, TSV, Parquet, JSON or JSON Lines file");

  const name = tableNameFor(file.name, takenNames);
  takenNames.add(name);
  // Registered under the table name, so two files called data.csv in different folders can't clash.
  const path = `${name}.${format}`;
  const started = performance.now();
  try {
    await registerFile(path, file);
    // Creating the view reads the schema, so an unreadable file fails here rather than later.
    await query(`CREATE VIEW ${quoteIdentifier(name)} AS SELECT * FROM ${readerFor(format, path)}`);
    const columns = await query(`DESCRIBE ${quoteIdentifier(name)}`);
    measureSince(measures.import, started);
    return { name, fileName: file.name, format, columnCount: columns.numRows, file };
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

/** Imports each file as a table. Files are imported one at a time, in order. */
export async function importFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  update((current) => ({
    ...current,
    importing: [...current.importing, ...files.map((file) => file.name)],
    failures: [],
  }));

  for (const file of files) {
    try {
      const table = await importFile(file);
      update((current) => ({ ...current, tables: [...current.tables, table] }));
    } catch (error) {
      const message =
        error instanceof Error
          ? parseEngineError(error, "", { preservePlainText: true }).message
          : String(error);
      update((current) => ({
        ...current,
        failures: [...current.failures, { fileName: file.name, message }],
      }));
    } finally {
      update((current) => {
        const index = current.importing.indexOf(file.name);
        return { ...current, importing: current.importing.toSpliced(index, 1) };
      });
    }
  }
}

/**
 * Imports every table's file again, e.g. into a restarted engine, which starts with none. Files are
 * imported in the same order, so each table gets its old name back.
 */
export async function reimportTables(): Promise<void> {
  const files = catalog.tables.map((table) => table.file);
  takenNames.clear();
  update((current) => ({ ...current, tables: [], failures: [] }));
  await importFiles(files);
}

/** Empties the catalog. For tests; it doesn't drop anything from the engine. */
export function resetCatalog(): void {
  takenNames.clear();
  update(() => ({ tables: [], importing: [], failures: [] }));
}
