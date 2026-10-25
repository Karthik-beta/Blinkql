// The catalog: tables imported from local files. Each file is registered with the engine by handle
// and gets a view named after it, so SQL reads the file directly (see the Architecture page). A copy
// of each file is kept in the browser (stored-datasets.ts), so its table comes back after a reload.
import { query, registerFile, unregisterFile } from "@/engine/engine";
import { parseEngineError } from "@/features/results/engine-error";
import { measureSince, measures } from "@/lib/user-timing";
import { detectFormat, type FileFormat, quoteIdentifier, readerFor, tableNameFor } from "./formats";
import { listDatasets, loadDataset, removeDataset, saveDataset } from "./stored-datasets";

export type ImportedTable = {
  /** The view's name, used in SQL. */
  name: string;
  fileName: string;
  format: FileFormat;
  columns: readonly TableColumn[];
  /** The file itself, kept so it can be imported again into a restarted engine. */
  file: File;
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
  /** True once a file couldn't be kept in the browser, so its table will be gone after a reload. */
  storageUnavailable: boolean;
};

/** A file to import and, for one imported before, the name and format its table had. */
type Source = { file: File; name?: string; format?: FileFormat };

const empty: Catalog = { tables: [], importing: [], failures: [], storageUnavailable: false };
let catalog = empty;
let restoring: Promise<void> | null = null;
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

async function importFile({ file, ...previous }: Source): Promise<ImportedTable> {
  const format = previous.format ?? detectFormat(file.name);
  if (!format) throw new Error("Not a CSV, TSV, Parquet, JSON or JSON Lines file");

  const name = tableNameFor(previous.name ?? file.name, takenNames);
  takenNames.add(name);
  // Registered under the table name, so two files called data.csv in different folders can't clash.
  const path = `${name}.${format}`;
  const started = performance.now();
  try {
    await registerFile(path, file);
    // Creating the view reads the schema, so an unreadable file fails here rather than later.
    await query(`CREATE VIEW ${quoteIdentifier(name)} AS SELECT * FROM ${readerFor(format, path)}`);
    const columns = (await query(`DESCRIBE ${quoteIdentifier(name)}`))
      .toArray()
      .map((row) => ({ name: String(row.column_name), type: String(row.column_type) }));
    measureSince(measures.import, started);
    return { name, fileName: file.name, format, columns, file };
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

/** Copies being saved, by table name, so forgetting a table can wait for its copy first. */
const saving = new Map<string, Promise<void>>();

/** Keeps a copy of `table`'s file in the browser, in the background. */
function keep({ name, fileName, format, file }: ImportedTable): void {
  const saved = saveDataset({ name, fileName, format, size: file.size, savedAt: Date.now() }, file)
    .catch(() => update((current) => ({ ...current, storageUnavailable: true })))
    .finally(() => saving.delete(name));
  saving.set(name, saved);
}

/**
 * Imports each file as a table, one at a time, in order, and keeps a copy of it in the background.
 */
export function importFiles(files: readonly File[]): Promise<void> {
  return importSources(
    files.map((file) => ({ file })),
    true,
  );
}

async function importSources(sources: readonly Source[], keepCopies: boolean): Promise<void> {
  if (sources.length === 0) return;
  update((current) => ({
    ...current,
    importing: [...current.importing, ...sources.map(({ file }) => file.name)],
    failures: [],
  }));

  for (const source of sources) {
    const { file } = source;
    try {
      const table = await importFile(source);
      update((current) => ({ ...current, tables: [...current.tables, table] }));
      if (keepCopies) keep(table);
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
  const sources = catalog.tables.map(({ file, name, format }) => ({ file, name, format }));
  takenNames.clear();
  update((current) => ({ ...current, tables: [], failures: [] }));
  await importSources(sources, false);
}

/**
 * Imports the files kept from earlier visits, each under its old table name. Calling it again does
 * nothing until resetCatalog().
 */
export function restoreDatasets(): Promise<void> {
  restoring ??= (async () => {
    const sources: Source[] = [];
    for (const dataset of await listDatasets()) {
      try {
        const stored = await loadDataset(dataset.name);
        // Named as the user's file was, so the table still shows where it came from.
        const file = new File([stored], dataset.fileName, { lastModified: stored.lastModified });
        sources.push({ file, name: dataset.name, format: dataset.format });
      } catch {
        // The browser lost the file, so forget the dataset too.
        await removeDataset(dataset.name).catch(() => {});
      }
    }
    await importSources(sources, false);
  })();
  return restoring;
}

/** Drops table `name` from the engine and the catalog, and deletes its kept copy. */
export async function forgetTable(name: string): Promise<void> {
  const table = catalog.tables.find((other) => other.name === name);
  if (!table) return;
  update((current) => ({ ...current, tables: current.tables.filter((other) => other !== table) }));
  await query(`DROP VIEW IF EXISTS ${quoteIdentifier(name)}`).catch(() => {});
  await unregisterFile(`${name}.${table.format}`).catch(() => {});
  await saving.get(name);
  await removeDataset(name).catch(() => {});
  takenNames.delete(name);
}

/** Empties the catalog. For tests; it doesn't drop anything from the engine. */
export function resetCatalog(): void {
  takenNames.clear();
  restoring = null;
  update(() => empty);
}
