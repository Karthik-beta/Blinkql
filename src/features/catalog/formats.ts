// Which files Blinkql can import, and the SQL that reads each kind.

import { keywords } from "@/features/editor/duckdb-words";

export type FileFormat = "csv" | "parquet" | "json" | "jsonl" | "xlsx";

const formatsByExtension: Readonly<Record<string, FileFormat>> = {
  csv: "csv",
  tsv: "csv",
  parquet: "parquet",
  json: "json",
  jsonl: "jsonl",
  ndjson: "jsonl",
  xlsx: "xlsx",
};

/** The `accept` value for file pickers. */
export const acceptedExtensions = Object.keys(formatsByExtension)
  .map((extension) => `.${extension}`)
  .join(",");

function splitExtension(fileName: string): [base: string, extension: string] {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return [fileName, ""];
  return [fileName.slice(0, dot), fileName.slice(dot + 1).toLowerCase()];
}

/** The format of a file, judged by its extension, or null if Blinkql can't read it. */
export function detectFormat(fileName: string): FileFormat | null {
  const [, extension] = splitExtension(fileName);
  return formatsByExtension[extension] ?? null;
}

/** Why a file whose format detectFormat() doesn't know can't be imported. */
export function unsupportedFormatMessage(fileName: string): string {
  const [, extension] = splitExtension(fileName);
  return extension === "xls"
    ? "Excel 97–2003 workbooks (.xls) can't be read. Save it as .xlsx in Excel first."
    : "Not a CSV, TSV, Excel (.xlsx), Parquet, JSON or JSON Lines file";
}

/**
 * A SQL-friendly table name derived from the file name: "Orders 2024.csv" becomes "orders_2024".
 * Adds a numeric suffix when the name is already in `taken`.
 */
export function tableNameFor(fileName: string, taken: ReadonlySet<string>): string {
  const [base] = splitExtension(fileName);
  let name = base
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (name === "") name = "table";
  if (/^[0-9]/.test(name)) name = `t_${name}`;

  if (!taken.has(name)) return name;
  let suffix = 2;
  while (taken.has(`${name}_${suffix}`)) suffix++;
  return `${name}_${suffix}`;
}

/** Quotes a name for use as a SQL identifier. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const keywordSet = new Set(keywords.split(/\s+/));

/** `name` as SQL refers to it: as is if it's a plain lowercase name, otherwise quoted. */
export function sqlName(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !keywordSet.has(name) ? name : quoteIdentifier(name);
}

function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * A table function that reads the registered file at `path`. DuckDB's sniffer detects a CSV's
 * delimiter, header and column types, and whether a .json file is an array or one object per line.
 * A workbook is read from its first sheet, the header row detected the same way.
 */
export function readerFor(format: FileFormat, path: string): string {
  const file = quoteString(path);
  switch (format) {
    case "csv":
      return `read_csv(${file})`;
    case "parquet":
      return `read_parquet(${file})`;
    case "json":
      return `read_json(${file})`;
    case "jsonl":
      return `read_json(${file}, format = 'newline_delimited')`;
    case "xlsx":
      return `read_xlsx(${file})`;
  }
}
