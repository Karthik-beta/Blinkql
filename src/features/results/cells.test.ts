import {
  Binary,
  Bool,
  type DataType,
  DateDay,
  Decimal,
  Dictionary,
  Field,
  Float64,
  Int32,
  Int64,
  List,
  Map_,
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
  type Vector,
  vectorFromArray,
} from "apache-arrow";
import { describe, expect, it } from "vitest";
import { resultColumns } from "./cells";

function listOf<T extends DataType>(type: T) {
  return new List(new Field("item", type));
}

/** The text of the first cell of a one-column result holding `vector`. */
function firstCell(vector: Vector) {
  const [column] = resultColumns(new Table({ value: vector }));
  return column?.cell(0);
}

/** The text of the first cell of a one-column result holding `values` as `type`. */
function cell(values: unknown[], type: DataType) {
  return firstCell(vectorFromArray(values, type));
}

describe("resultColumns", () => {
  it("reads each column's cells by row, with null for SQL NULL", () => {
    const table = new Table({
      id: vectorFromArray([1, 2], new Int32()),
      name: vectorFromArray(["a", null], new Utf8()),
    });
    const columns = resultColumns(table);

    expect(columns.map(({ name, type }) => [name, String(type)])).toEqual([
      ["id", "Int32"],
      ["name", "Utf8"],
    ]);
    expect([0, 1].map((row) => columns.map((column) => column.cell(row)))).toEqual([
      ["1", "a"],
      ["2", null],
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
    const columns = resultColumns(new Table(new RecordBatch(new Schema(schema), data)));

    expect(columns.map((column) => [column.name, column.cell(0)])).toEqual([
      ["x", "1"],
      ["x", "2"],
    ]);
  });

  it("reads rows across record batches", () => {
    // DuckDB sends a large result as several batches, so a column's vector has several chunks.
    const batch = (ids: number[]) => new Table({ id: vectorFromArray(ids, new Int32()) });
    const table = batch([1, 2]).concat(batch([3]), batch([4, 5]));
    const [id] = resultColumns(table);

    expect(table.getChildAt(0)?.data).toHaveLength(3);
    expect([0, 1, 2, 3, 4].map((row) => id?.cell(row))).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("has a column but no cells for an empty result", () => {
    const [id] = resultColumns(new Table({ id: vectorFromArray([], new Int32()) }));
    expect(id?.name).toBe("id");
  });
});

describe("cell formatting", () => {
  it("shows strings, numbers and booleans as they are", () => {
    expect(cell(["hello"], new Utf8())).toBe("hello");
    expect(cell([42], new Int32())).toBe("42");
    expect(cell([1.5], new Float64())).toBe("1.5");
    expect(cell([true], new Bool())).toBe("true");
  });

  it("shows 64-bit integers in full", () => {
    expect(cell([9007199254740993n], new Int64())).toBe("9007199254740993");
  });

  it("shows dates, timestamps and times the way DuckDB writes them", () => {
    const day = Date.UTC(2026, 9, 16);
    expect(cell([new Date(day)], new DateDay())).toBe("2026-10-16");
    // Built from stored values: vectorFromArray would take these as milliseconds.
    const micros = BigInt64Array.of(BigInt(day + 5_237_000) * 1000n);
    const timestamp = makeData({ type: new TimestampMicrosecond(), length: 1, data: micros });
    expect(firstCell(makeVector(timestamp))).toBe("2026-10-16 01:27:17");
    expect(cell([day + 5_237_250], new TimestampMillisecond())).toBe("2026-10-16 01:27:17.250");
    expect(cell([19_637_000_000n], new TimeMicrosecond())).toBe("05:27:17");
    const fraction = BigInt64Array.of(19_637_120_000n);
    const time = makeData({ type: new TimeMicrosecond(), length: 1, data: fraction });
    expect(firstCell(makeVector(time))).toBe("05:27:17.12");
  });

  it("puts the decimal point where the column's scale says", () => {
    const decimal = (unscaled: number, scale: number) => {
      const words = new Uint32Array(4);
      new BigInt64Array(words.buffer)[0] = BigInt(unscaled);
      new BigInt64Array(words.buffer)[1] = unscaled < 0 ? -1n : 0n;
      const type = new Decimal(scale, 18, 128);
      return firstCell(makeVector(makeData({ type, length: 1, nullCount: 0, data: words })));
    };

    expect(decimal(12345, 2)).toBe("123.45");
    expect(decimal(-12345, 2)).toBe("-123.45");
    expect(decimal(5, 3)).toBe("0.005");
    expect(decimal(7, 0)).toBe("7");
  });

  it("shows bytes the way DuckDB writes a BLOB", () => {
    const bytes = new Uint8Array([0x41, 0x00, 0xff, 0x5c]);
    expect(cell([bytes], new Binary())).toBe("A\\x00\\xFF\\x5C");
  });

  it("shows lists, structs and maps as JSON", () => {
    expect(cell([[1, null, 2]], listOf(new Int32()))).toBe("[1,null,2]");
    const struct = new Struct([new Field("a", new Int64()), new Field("b", new Utf8())]);
    expect(cell([{ a: 2n ** 60n, b: "x" }], struct)).toBe('{"a":1152921504606846976,"b":"x"}');
    const map = new Map_<Utf8, Int32>(
      new Field(
        "entries",
        new Struct([new Field("key", new Utf8(), false), new Field("value", new Int32())]),
      ),
    );
    expect(cell([new Map([["k", 1]])], map)).toBe('{"k":1}');
  });

  it("formats values inside lists, structs and maps by their own type", () => {
    const day = Date.UTC(2026, 9, 16);
    expect(cell([[new Date(day)]], listOf(new DateDay()))).toBe('["2026-10-16"]');

    const struct = new Struct([
      new Field("at", new TimestampMillisecond()),
      new Field("bytes", new Binary()),
      new Field("ratio", new Float64()),
    ]);
    expect(
      cell([{ at: day + 5_237_000, bytes: new Uint8Array([0x41, 0x00]), ratio: NaN }], struct),
    ).toBe('{"at":"2026-10-16 01:27:17","bytes":"A\\\\x00","ratio":"NaN"}');

    const nested = listOf(new Struct([new Field("days", listOf(new DateDay()))]));
    expect(cell([[{ days: [new Date(day), null] }]], nested)).toBe(
      '[{"days":["2026-10-16",null]}]',
    );
  });

  it("writes decimals inside a list with their scale", () => {
    const type = new Decimal(2, 18, 128);
    const words = new Uint32Array(8);
    new BigInt64Array(words.buffer)[0] = 12345n;
    new BigInt64Array(words.buffer)[2] = -5n;
    new BigInt64Array(words.buffer)[3] = -1n;
    const decimals = makeData({ type, length: 2, nullCount: 0, data: words });
    const list = makeData({
      type: listOf(type),
      length: 1,
      nullCount: 0,
      valueOffsets: new Int32Array([0, 2]),
      child: decimals,
    });

    expect(firstCell(makeVector(list))).toBe("[123.45,-0.05]");
  });

  it("shows a dictionary-encoded column (a DuckDB ENUM) by its values", () => {
    const vector = vectorFromArray(["RUN", "IDLE"], new Dictionary(new Utf8(), new Int32()));
    const [status] = resultColumns(new Table({ status: vector }));
    expect(status?.cell(1)).toBe("IDLE");
  });
});
