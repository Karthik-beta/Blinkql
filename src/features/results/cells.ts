// Reading cells straight from an Arrow result and turning them into text, for the results table.
// Nothing is copied out of Arrow: a cell is read and formatted only when it's shown (ADR-004, P-02).
import { type Data, DataType, Int64, type Table, Vector } from "apache-arrow";

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
    const column = table.getChildAt(index);
    const vector = column && new Vector(column.data.map(storedTimestamps));
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

/** Whether values of `type` are numbers, which line up on the right so their digits do too. */
export function isNumeric(type: DataType): boolean {
  return DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type);
}

/**
 * `data` with its timestamps, at any depth, read as the int64 counts they're stored as. Arrow reads
 * a timestamp as milliseconds in a number, which throws for values far from 1970 such as DuckDB's
 * 'infinity'. The timestamp type stays in the column's schema, which picks the formatter.
 */
function storedTimestamps(data: Data): Data {
  if (DataType.isTimestamp(data.type)) return data.clone(new Int64());
  if (data.children.length === 0) return data;
  const children = data.children.map(storedTimestamps);
  return data.clone(data.type, data.offset, data.length, data.nullCount, undefined, children);
}

const msPerDay = 86_400_000;
const daysPer400Years = 146_097;
/** DuckDB's 'infinity' DATE, as days since 1970. '-infinity' is its negation. */
const infiniteDays = 2 ** 31 - 1;
/** DuckDB's 'infinity' TIMESTAMP in any unit. '-infinity' is its negation. */
const infiniteTimestamp = 2n ** 63n - 1n;

/** "2026-10-16", or "0001-12-31 (BC)", from days since 1970, for every date DuckDB holds. */
function formatDate(days: number): string {
  if (Math.abs(days) === infiniteDays) return days > 0 ? "infinity" : "-infinity";
  // Date stops at the year 275760. The calendar repeats every 400 years, so move into range and back.
  const cycles = Math.floor(days / daysPer400Years);
  const date = new Date((days - cycles * daysPer400Years) * msPerDay);
  const year = date.getUTCFullYear() + cycles * 400;
  const monthAndDay = date.toISOString().slice(4, 10);
  return year > 0
    ? `${String(year).padStart(4, "0")}${monthAndDay}`
    : `${String(1 - year).padStart(4, "0")}${monthAndDay} (BC)`;
}

/** "2026-10-16 05:47:17", or with milliseconds when there are any, from a count of units since 1970. */
function formatTimestamp(stored: bigint, unitsPerSecond: number): string {
  if (stored === infiniteTimestamp) return "infinity";
  if (stored === -infiniteTimestamp) return "-infinity";
  const perSecond = BigInt(unitsPerSecond);
  const perDay = perSecond * 86_400n;
  const sinceMidnight = ((stored % perDay) + perDay) % perDay;
  const days = Number((stored - sinceMidnight) / perDay);
  const clock = new Date(Number((sinceMidnight * 1000n) / perSecond))
    .toISOString()
    .slice(11, 23)
    .replace(/\.000$/, "");
  return `${formatDate(days)} ${clock}`;
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
    const writeFields = type.children.map((field) => {
      const key = JSON.stringify(field.name);
      const write = nullable(jsonWriterFor(field.type));
      return (item: unknown) => `${key}:${write(item)}`;
    });
    // A struct value is an Arrow StructRow, which iterates [name, value] pairs in field order.
    // Reading fields by name instead would go through StructRow's proxy, where its own methods win
    // over fields of the same name (toString, constructor, __proto__) and duplicate names clash.
    return (value) =>
      `{${Array.from(value as Iterable<[string, unknown]>, ([, item], index) =>
        writeFields[index]?.(item),
      ).join(",")}}`;
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
  // Integers (64-bit ones in full), durations and decimals are already valid JSON numbers.
  if (DataType.isInt(type) || DataType.isDuration(type) || DataType.isDecimal(type)) {
    return formatterFor(type);
  }
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
      typeof value === "number" ? formatDate(Math.floor(value / msPerDay)) : formatAny(value);
  }
  if (DataType.isTimestamp(type)) {
    const perSecond = unitsPerSecond[type.unit];
    return (value) =>
      typeof value === "bigint" ? formatTimestamp(value, perSecond) : formatAny(value);
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
