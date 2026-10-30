// The catalog: tables imported from local files or read from the web. Each file is registered with
// the engine, by handle or by URL, and gets a view named after it, so SQL reads the file directly
// (see the Architecture page). A copy of each local file is kept in the browser
// (stored-datasets.ts), so its table comes back after a reload.
import { exportQuery, query, registerFile, registerUrl, unregisterFile } from "@/engine/engine";
import { parseEngineError } from "@/features/results/engine-error";
import { measureSince, measures } from "@/lib/user-timing";
import {
  detectFormat,
  type FileFormat,
  quoteIdentifier,
  readerFor,
  tableNameFor,
  unsupportedFormatMessage,
} from "./formats";
import { deviceMemoryGiB, memoryWarning } from "./memory";
import { probeRemoteFile, remoteFileName, remoteReadMessage } from "./remote";
import { listDatasets, loadDataset, removeDataset, saveDataset } from "./stored-datasets";

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
  /** Set when the file was imported but its table couldn't be converted to Parquet. */
  during?: "conversion";
};

export type Catalog = {
  tables: readonly ImportedTable[];
  /** Names of files still being imported. */
  importing: readonly string[];
  /** Names of tables still being converted to Parquet. */
  converting: readonly string[];
  /** Files from the most recent import or conversion that couldn't be imported or converted. */
  failures: readonly ImportFailure[];
  /** Files from the most recent import that were imported but may not fit in memory or be slow. */
  warnings: readonly ImportFailure[];
  /** True once a file couldn't be kept in the browser, so its table will be gone after a reload. */
  storageUnavailable: boolean;
};

/** A file or URL to import and, for one imported before, the name and format its table had. */
type Source = { source: File | URL; name?: string; format?: FileFormat };

const empty: Catalog = {
  tables: [],
  importing: [],
  converting: [],
  failures: [],
  warnings: [],
  storageUnavailable: false,
};
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

function displayName(source: File | URL): string {
  return source instanceof URL ? source.href : source.name;
}

async function importFile({ source, ...previous }: Source): Promise<ImportedTable> {
  const fileName = source instanceof URL ? remoteFileName(source) : source.name;
  const format = previous.format ?? detectFormat(fileName);
  if (!format) throw new Error(unsupportedFormatMessage(fileName));
  if (source instanceof URL) {
    const warning = await probeRemoteFile(source);
    if (warning) {
      const warned = { fileName: source.href, message: warning };
      update((current) => ({ ...current, warnings: [...current.warnings, warned] }));
    }
  }

  const name = tableNameFor(previous.name ?? fileName, takenNames);
  takenNames.add(name);
  // Registered under the table name, so two files called data.csv in different folders can't clash.
  const path = `${name}.${format}`;
  const started = performance.now();
  try {
    if (source instanceof URL) await registerUrl(path, source.href);
    else await registerFile(path, source);
    // Creating the view reads the schema, so an unreadable file fails here rather than later.
    await query(`CREATE VIEW ${quoteIdentifier(name)} AS SELECT * FROM ${readerFor(format, path)}`);
    const columns = await describeTable(name);
    measureSince(measures.import, started);
    return { name, fileName: displayName(source), format, columns, source };
  } catch (error) {
    await query(`DROP VIEW IF EXISTS ${quoteIdentifier(name)}`).catch(() => {});
    await unregisterFile(path).catch(() => {});
    takenNames.delete(name);
    if (format === "xlsx" && error instanceof Error && UNREADABLE_WORKBOOK.test(error.message)) {
      throw new Error(UNREADABLE_WORKBOOK_MESSAGE);
    }
    throw error;
  }
}

// An .xlsx file is a zip archive. Password-protected workbooks are encrypted containers instead,
// and an .xls file renamed .xlsx is the old binary format, so DuckDB can't open either as a zip.
const UNREADABLE_WORKBOOK = /Failed to open zip/;
const UNREADABLE_WORKBOOK_MESSAGE =
  "The workbook can't be read. It may be password-protected or an older .xls file: " +
  "remove the password or save it as .xlsx in Excel, then import it again.";

async function describeTable(table: string): Promise<TableColumn[]> {
  return (await query(`DESCRIBE ${quoteIdentifier(table)}`))
    .toArray()
    .map((row) => ({ name: String(row.column_name), type: String(row.column_type) }));
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

/** Keeps a copy of `table`'s file in the browser, in the background. Remote files aren't kept. */
function keep({ name, fileName, format, source }: ImportedTable): void {
  if (source instanceof URL) return;
  const meta = { name, fileName, format, size: source.size, savedAt: Date.now() };
  const saved = saveDataset(meta, source)
    .catch(() => update((current) => ({ ...current, storageUnavailable: true })))
    .finally(() => saving.delete(name));
  saving.set(name, saved);
}

/**
 * Imports each file, local or on the web, as a table, one at a time and in order, and keeps a copy
 * of each local file in the background.
 */
export function importFiles(files: readonly (File | URL)[]): Promise<void> {
  return importSources(
    files.map((source) => ({ source })),
    true,
  );
}

function messageFor(error: unknown): string {
  return error instanceof Error
    ? remoteReadMessage(parseEngineError(error, "", { preservePlainText: true }).message)
    : String(error);
}

async function importSources(sources: readonly Source[], keepCopies: boolean): Promise<void> {
  if (sources.length === 0) return;
  update((current) => ({
    ...current,
    importing: [...current.importing, ...sources.map(({ source }) => displayName(source))],
    failures: [],
    warnings: [],
  }));

  for (const toImport of sources) {
    const { source } = toImport;
    const fileName = displayName(source);
    try {
      const table = await importFile(toImport);
      const warning =
        source instanceof URL
          ? null
          : memoryWarning(source.size, { deviceMemoryGiB: deviceMemoryGiB() });
      update((current) => ({
        ...current,
        tables: [...current.tables, table],
        warnings: warning
          ? [...current.warnings, { fileName, message: warning }]
          : current.warnings,
      }));
      if (keepCopies) keep(table);
    } catch (error) {
      update((current) => ({
        ...current,
        failures: [...current.failures, { fileName, message: messageFor(error) }],
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
  const sources = catalog.tables.map(({ source, name, format }) => ({ source, name, format }));
  takenNames.clear();
  update((current) => ({ ...current, tables: [], failures: [], warnings: [] }));
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
        sources.push({ source: file, name: dataset.name, format: dataset.format });
      } catch {
        // The browser lost the file, so forget the dataset too.
        await removeDataset(dataset.name).catch(() => {});
      }
    }
    await importSources(sources, false);
  })();
  return restoring;
}

/** Whether `table` can be converted to Parquet: it reads a local CSV or TSV file. */
export function isConvertible(table: ImportedTable): boolean {
  return table.format === "csv" && table.source instanceof File;
}

/**
 * Converts table `name`, a local CSV file, to Parquet: the engine writes the Parquet file in its
 * worker, the view is pointed at it and it replaces the kept copy, so later queries, and the table
 * after a reload, read Parquet instead of parsing the CSV again (P-09). If it fails, the table
 * keeps reading the CSV and the failure is reported with the import failures.
 */
export async function convertTable(name: string): Promise<void> {
  const table = catalog.tables.find((other) => other.name === name);
  if (!table || !isConvertible(table) || catalog.converting.includes(name)) return;
  update((current) => ({ ...current, converting: [...current.converting, name], failures: [] }));
  const csvPath = `${name}.csv`;
  const path = `${name}.parquet`;
  const pointViewAt = (format: FileFormat, at: string) =>
    query(
      `CREATE OR REPLACE VIEW ${quoteIdentifier(name)} AS SELECT * FROM ${readerFor(format, at)}`,
    );
  let registered = false;
  try {
    const bytes = await exportQuery(`SELECT * FROM ${readerFor("csv", csvPath)}`, "parquet");
    // Forgotten, or the engine restarted, while it was being converted.
    if (!catalog.tables.includes(table)) return;
    // Named as the user's file was, like a restored table's, so it still shows where it came from.
    const file = new File([bytes], table.fileName);
    await registerFile(path, file);
    registered = true;
    await pointViewAt("parquet", path);
    const converted: ImportedTable = {
      ...table,
      format: "parquet",
      columns: await describeTable(name),
      source: file,
    };
    await unregisterFile(csvPath).catch(() => {});
    update((current) => ({
      ...current,
      tables: current.tables.map((other) => (other === table ? converted : other)),
    }));
    // The CSV's copy may still be being written; the Parquet one replaces it once it has been.
    await saving.get(name);
    keep(converted);
  } catch (error) {
    if (registered) {
      await pointViewAt("csv", csvPath).catch(() => {});
      await unregisterFile(path).catch(() => {});
    }
    update((current) => ({
      ...current,
      failures: [
        ...current.failures,
        { fileName: table.fileName, message: messageFor(error), during: "conversion" },
      ],
    }));
  } finally {
    update((current) => ({
      ...current,
      converting: current.converting.filter((other) => other !== name),
    }));
  }
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
