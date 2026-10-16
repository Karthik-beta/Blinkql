import {
  Binary,
  Bool,
  type DataType,
  DateDay,
  Decimal,
  Field,
  Float64,
  Int32,
  Int64,
  List,
  makeData,
  makeVector,
  RecordBatch,
  Schema,
  Struct,
  Table,
  TimeMicrosecond,
  TimestampMicrosecond,
  TimestampMillisecond,
  Utf8,
  vectorFromArray,
} from "apache-arrow";
import { describe, expect, it } from "vitest";
import { formatCell, toRowObjects } from "./cells";

/** The first value of a one-element vector, with its type. */
function first<T extends DataType>(values: unknown[], type: T) {
  const vector = vectorFromArray(values, type);
  return [vector.get(0), vector.type] as const;
}

describe("toRowObjects", () => {
  it("makes one object per row, keyed by column position", () => {
    const table = new Table({
      id: vectorFromArray([1, 2], new Int32()),
      name: vectorFromArray(["a", null], new Utf8()),
    });

    expect(toRowObjects(table)).toEqual([
      { 0: 1, 1: "a" },
      { 0: 2, 1: null },
    ]);
  });

  it("keeps columns that share a name", () => {
    // What DuckDB returns for SELECT 1 AS x, 2 AS x.
    const schema = [new Field("x", new Int32()), new Field("x", new Int32())];
    const data = makeData({
      type: new Struct(schema),
      length: 1,
      nullCount: 0,
      children: [
        makeData({ type: new Int32(), data: new Int32Array([1]) }),
        makeData({ type: new Int32(), data: new Int32Array([2]) }),
      ],
    });
    const table = new Table(new RecordBatch(new Schema(schema), data));

    expect(toRowObjects(table)).toEqual([{ 0: 1, 1: 2 }]);
  });

  it("returns no rows for an empty result", () => {
    const table = new Table({ id: vectorFromArray([], new Int32()) });
    expect(toRowObjects(table)).toEqual([]);
  });
});

describe("formatCell", () => {
  it("returns null for SQL NULL", () => {
    expect(formatCell(null, new Utf8())).toBeNull();
  });

  it("shows strings, numbers and booleans as they are", () => {
    expect(formatCell(...first(["hello"], new Utf8()))).toBe("hello");
    expect(formatCell(...first([42], new Int32()))).toBe("42");
    expect(formatCell(...first([1.5], new Float64()))).toBe("1.5");
    expect(formatCell(...first([true], new Bool()))).toBe("true");
  });

  it("shows 64-bit integers in full", () => {
    expect(formatCell(...first([9007199254740993n], new Int64()))).toBe("9007199254740993");
  });

  it("shows dates, timestamps and times the way DuckDB writes them", () => {
    const day = Date.UTC(2026, 9, 16);
    expect(formatCell(...first([new Date(day)], new DateDay()))).toBe("2026-10-16");
    expect(formatCell(day + 5_237_000, new TimestampMicrosecond())).toBe("2026-10-16 01:27:17");
    expect(formatCell(day + 5_237_250, new TimestampMillisecond())).toBe("2026-10-16 01:27:17.250");
    expect(formatCell(...first([19_637_000_000n], new TimeMicrosecond()))).toBe("05:27:17");
    expect(formatCell(19_637_120_000n, new TimeMicrosecond())).toBe("05:27:17.12");
  });

  it("puts the decimal point where the column's scale says", () => {
    const decimal = (unscaled: number, scale: number) => {
      const type = new Decimal(scale, 18, 128);
      const words = new Uint32Array(4);
      new BigInt64Array(words.buffer)[0] = BigInt(unscaled);
      new BigInt64Array(words.buffer)[1] = unscaled < 0 ? -1n : 0n;
      const vector = makeVector(makeData({ type, length: 1, nullCount: 0, data: words }));
      return formatCell(vector.get(0), type);
    };

    expect(decimal(12345, 2)).toBe("123.45");
    expect(decimal(-12345, 2)).toBe("-123.45");
    expect(decimal(5, 3)).toBe("0.005");
    expect(decimal(7, 0)).toBe("7");
  });

  it("shows bytes the way DuckDB writes a BLOB", () => {
    const bytes = new Uint8Array([0x41, 0x00, 0xff, 0x5c]);
    expect(formatCell(...first([bytes], new Binary()))).toBe("A\\x00\\xFF\\x5C");
  });

  it("shows lists and structs as JSON", () => {
    expect(formatCell(...first([[1, 2]], new List(new Field("item", new Int32()))))).toBe("[1,2]");
    const struct = new Struct([new Field("a", new Int64()), new Field("b", new Utf8())]);
    expect(formatCell(...first([{ a: 2n ** 60n, b: "x" }], struct))).toBe(
      '{"a":"1152921504606846976","b":"x"}',
    );
  });
});
