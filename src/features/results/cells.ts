// Reading cells straight from an Arrow result and turning them into text, for the results table.
// Nothing is copied out of Arrow: a cell is read and formatted only when it's shown (ADR-004, P-02).
import { DataType, type Table } from "apache-arrow";

/** One column of a result, read from its Arrow vector on demand. */
export type ResultColumn = {
  name: string;
  type: DataType;
  /** The text for row `rowIndex`, or null for SQL NULL. Reads and formats the value on every call. */
  cell: (rowIndex: number) => string | null;
};

/**
 * The columns of `table`, each reading cells from its Arrow vector with the formatter for its type.
 * Columns are taken by position, so duplicate column names can't clash.
 */
export function resultColumns(table: Table): ResultColumn[] {
  return table.schema.fields.map((field, index) => {
    const vector = table.getChildAt(index);
    const format = formatterFor(field.type);
    return {
      name: field.name,
      type: field.type,
      cell: (rowIndex) => {
        const value: unknown = vector?.get(rowIndex);
        return value === null || value === undefined ? null : format(value);
      },
    };
  });
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

/**
 * Plain JSON, for values of types without a format of their own (unions, for example). 64-bit
 * integers too big for a number become strings.
 */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item !== "bigint") return item;
    const number = Number(item);
    return Number.isSafeInteger(number) ? number : String(item);
  });
}

const unitsPerSecond = [1, 1_000, 1_000_000, 1_000_000_000] as const;

/** Turns one non-null value of an Arrow type into text. */
type Formatter = (value: unknown) => string;

/** Any value as text: strings as they are, objects as JSON. */
function formatAny(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object") return toJson(value);
  return String(value);
}

/** Turns one non-null value of an Arrow type into JSON, for a value inside a list, struct or map. */
type JsonWriter = (value: unknown) => string;

/** The same writer, also accepting null. */
function nullable(write: JsonWriter): JsonWriter {
  return (value) => (value === null || value === undefined ? "null" : write(value));
}

/**
 * The JSON writer for values of `type` inside a list, struct or map. Nested values are formatted by
 * their own type, like top-level cells: dates as "2026-10-16" rather than milliseconds, decimals
 * with their scale and BLOBs as \xHH escapes. Numbers stay JSON numbers, written in full.
 */
function jsonWriterFor(type: DataType): JsonWriter {
  if (DataType.isDictionary(type)) return jsonWriterFor(type.dictionary);
  if (DataType.isList(type) || DataType.isFixedSizeList(type)) {
    const writeItem = nullable(jsonWriterFor(type.valueType));
    // A list value is an Arrow vector, which iterates its items.
    return (value) =>
      `[${Array.from(value as Iterable<unknown>, (item) => writeItem(item)).join(",")}]`;
  }
  if (DataType.isStruct(type)) {
    const fields = type.children.map((field) => ({
      name: field.name,
      key: JSON.stringify(field.name),
      write: nullable(jsonWriterFor(field.type)),
    }));
    return (value) => {
      // A struct value is an Arrow StructRow, which reads its fields by name.
      const row = value as Record<string, unknown>;
      return `{${fields.map(({ name, key, write }) => `${key}:${write(row[name])}`).join(",")}}`;
    };
  }
  if (DataType.isMap(type)) {
    const formatKey = formatterFor(type.keyType);
    const writeValue = nullable(jsonWriterFor(type.valueType));
    // A map value is an Arrow MapRow, which iterates [key, value] pairs. JSON keys are strings.
    return (value) =>
      `{${Array.from(
        value as Iterable<[unknown, unknown]>,
        ([key, item]) => `${JSON.stringify(formatKey(key))}:${writeValue(item)}`,
      ).join(",")}}`;
  }
  // Integers (64-bit ones in full) and decimals are already valid JSON numbers.
  if (DataType.isInt(type) || DataType.isDecimal(type)) return formatterFor(type);
  if (DataType.isFloat(type)) {
    // JSON has no NaN or Infinity, so those become strings.
    return (value) =>
      typeof value === "number" && !Number.isFinite(value) ? `"${value}"` : String(value);
  }
  const format = formatterFor(type);
  return format === formatAny ? toJson : (value) => JSON.stringify(format(value));
}

/** The formatter for values of `type`, chosen once per column rather than once per cell. */
function formatterFor(type: DataType): Formatter {
  if (DataType.isDictionary(type)) return formatterFor(type.dictionary);
  if (
    DataType.isList(type) ||
    DataType.isFixedSizeList(type) ||
    DataType.isStruct(type) ||
    DataType.isMap(type)
  ) {
    return jsonWriterFor(type);
  }
  if (DataType.isDate(type)) {
    return (value) =>
      typeof value === "number" ? formatTimestamp(value).slice(0, 10) : formatAny(value);
  }
  if (DataType.isTimestamp(type)) {
    return (value) => (typeof value === "number" ? formatTimestamp(value) : formatAny(value));
  }
  if (DataType.isTime(type)) {
    const perSecond = unitsPerSecond[type.unit];
    return (value) =>
      typeof value === "number" || typeof value === "bigint"
        ? formatTime(value, perSecond)
        : formatAny(value);
  }
  if (DataType.isDecimal(type)) {
    const { scale } = type;
    return (value) => formatDecimal(String(value), scale);
  }
  if (DataType.isBinary(type) || DataType.isLargeBinary(type) || DataType.isFixedSizeBinary(type)) {
    return (value) => (value instanceof Uint8Array ? formatBytes(value) : formatAny(value));
  }
  return formatAny;
}
