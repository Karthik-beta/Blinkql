// Turning Arrow results into row objects and cell values into text, for the results table.
import { DataType, type Table } from "apache-arrow";

/** One result row: cell values keyed by column position, so duplicate column names can't clash. */
export type Row = Record<number, unknown>;

/**
 * Every row of `table` as a row object.
 *
 * This is the M1 baseline and deliberately naive: it walks the whole result and allocates an object
 * per row, which ADR-004 exists to avoid. P-02 replaces it with lazy reads from the Arrow vectors;
 * leave it as it is until P-01 has measured it.
 */
export function toRowObjects(table: Table): Row[] {
  const columns = table.schema.fields.map((_, index) => table.getChildAt(index));
  const rows: Row[] = [];
  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex++) {
    const row: Row = {};
    for (const [columnIndex, column] of columns.entries()) {
      row[columnIndex] = column?.get(rowIndex);
    }
    rows.push(row);
  }
  return rows;
}

/** "2026-10-16 05:47:17", or with milliseconds when there are any, from milliseconds since 1970. */
function formatTimestamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace("T", " ")
    .replace(/(\.000)?Z$/, "");
}

/** "05:47:17", or with fractional seconds when there are any, from time since midnight. */
function formatTime(value: number | bigint, unitsPerSecond: number): string {
  const units = BigInt(value);
  const perSecond = BigInt(unitsPerSecond);
  const seconds = Number(units / perSecond);
  const clock = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  const fraction = units % perSecond;
  if (fraction === 0n) return clock;
  const digits = String(unitsPerSecond).length - 1;
  return `${clock}.${String(fraction).padStart(digits, "0").replace(/0+$/, "")}`;
}

/** An unscaled decimal ("-12345") with `scale` digits after the point ("-123.45"). */
function formatDecimal(unscaled: string, scale: number): string {
  if (scale === 0) return unscaled;
  const negative = unscaled.startsWith("-");
  const digits = (negative ? unscaled.slice(1) : unscaled).padStart(scale + 1, "0");
  const point = digits.length - scale;
  return `${negative ? "-" : ""}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Bytes as DuckDB writes a BLOB: printable ASCII as is, everything else as \xHH. */
function formatBytes(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text +=
      byte >= 0x20 && byte < 0x7f && byte !== 0x5c
        ? String.fromCharCode(byte)
        : `\\x${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return text;
}

/** JSON for lists, structs and maps. 64-bit integers too big for a number become strings. */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item !== "bigint") return item;
    const number = Number(item);
    return Number.isSafeInteger(number) ? number : String(item);
  });
}

const unitsPerSecond = [1, 1_000, 1_000_000, 1_000_000_000] as const;

/** How a cell is shown in the results table, or null for SQL NULL. */
export function formatCell(value: unknown, type: DataType): string | null {
  if (value === null || value === undefined) return null;
  if (DataType.isDate(type) && typeof value === "number") {
    return formatTimestamp(value).slice(0, 10);
  }
  if (DataType.isTimestamp(type) && typeof value === "number") return formatTimestamp(value);
  if (DataType.isTime(type) && (typeof value === "number" || typeof value === "bigint")) {
    return formatTime(value, unitsPerSecond[type.unit]);
  }
  if (DataType.isDecimal(type)) return formatDecimal(String(value), type.scale);
  if (DataType.isBinary(type) || DataType.isFixedSizeBinary(type)) {
    if (value instanceof Uint8Array) return formatBytes(value);
  }
  if (typeof value === "string") return value;
  if (typeof value === "object") return toJson(value);
  return String(value);
}
