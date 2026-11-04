import {
  Binary,
  Bool,
  type Data,
  type DataType,
  DateDay,
  Decimal,
  Dictionary,
  DurationMillisecond,
  Field,
  FixedSizeList,
  Float64,
  Int32,
  Int64,
  LargeBinary,
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
  TimestampNanosecond,
  TimestampSecond,
  Utf8,
  type Vector,
  vectorFromArray,
} from "apache-arrow";
import { describe, expect, it } from "vitest";
import { displayFor, resultColumns } from "./cells";

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

/** The text of every cell of a one-column result holding `data`. */
function cells(data: Data) {
  const [column] = resultColumns(new Table({ value: makeVector(data) }));
  return Array.from({ length: data.length }, (_, row) => column?.cell(row));
}

/** DuckDB's 'infinity' timestamp, stored as the largest int64 in every unit. */
const INFINITY = 2n ** 63n - 1n;

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

  it("has a column but no rows for an empty result", () => {
    const table = new Table({ id: vectorFromArray([], new Int32()) });
    expect(resultColumns(table).map((column) => column.name)).toEqual(["id"]);
    expect(table.numRows).toBe(0);
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

  // Built from stored values as DuckDB returns them: days for a DATE and a count of the unit for a
  // TIMESTAMP, with 'infinity' and '-infinity' at the ends of each range.
  it("shows infinite dates and dates outside JavaScript's range the way DuckDB writes them", () => {
    const dates = Int32Array.of(2_147_483_647, -2_147_483_647, 106_762_574, -2_147_483_646);
    expect(cells(makeData({ type: new DateDay(), data: dates }))).toEqual([
      "infinity",
      "-infinity",
      "294276-01-01",
      "5877642-06-25 (BC)",
    ]);
    const fourDigitYearsAndBeyond = Int32Array.of(2_932_897, -719_163);
    expect(cells(makeData({ type: new DateDay(), data: fourDigitYearsAndBeyond }))).toEqual([
      "10000-01-01",
      "0001-12-31 (BC)",
    ]);
  });

  it("shows infinite timestamps and timestamps outside JavaScript's range the way DuckDB writes them", () => {
    const types = [
      new TimestampSecond(),
      new TimestampMillisecond(),
      new TimestampMicrosecond(),
      new TimestampNanosecond(),
      new TimestampMicrosecond("UTC"),
    ];
    for (const type of types) {
      const data = BigInt64Array.of(INFINITY, -INFINITY);
      expect(cells(makeData({ type, data }))).toEqual(["infinity", "-infinity"]);
    }
    const micros = BigInt64Array.of(9_223_339_708_800_000_000n);
    expect(cells(makeData({ type: new TimestampMicrosecond(), data: micros }))).toEqual([
      "294246-01-01 00:00:00",
    ]);
    const seconds = BigInt64Array.of(9_089_348_860_800n);
    expect(cells(makeData({ type: new TimestampSecond(), data: seconds }))).toEqual([
      "290000-01-01 00:00:00",
    ]);
  });

  it("shows infinite dates and timestamps inside lists and structs", () => {
    const day = makeData({ type: new DateDay(), data: Int32Array.of(2_147_483_647) });
    const timestamp = makeData({
      type: new TimestampMicrosecond(),
      data: BigInt64Array.of(INFINITY),
    });
    const listOfOne = (child: Data) =>
      makeData({ type: listOf(child.type), length: 1, valueOffsets: Int32Array.of(0, 1), child });
    expect(cells(listOfOne(day))).toEqual(['["infinity"]']);
    expect(cells(listOfOne(timestamp))).toEqual(['["infinity"]']);
    const struct = new Struct([new Field("until", timestamp.type)]);
    expect(
      cells(makeData({ type: struct, length: 1, nullCount: 0, children: [timestamp] })),
    ).toEqual(['{"until":"infinity"}']);
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

  it("reads struct fields by position, whatever they're called", () => {
    // Names that are also properties of Arrow's StructRow, and a name used twice.
    const names = ["toString", "constructor", "__proto__", "x", "x"];
    const fields = names.map((name) => new Field(name, new Int32()));
    const struct = makeData({
      type: new Struct(fields),
      length: 1,
      nullCount: 0,
      children: names.map((_, index) =>
        makeData({ type: new Int32(), data: Int32Array.of(index + 1) }),
      ),
    });

    expect(firstCell(makeVector(struct))).toBe(
      '{"toString":1,"constructor":2,"__proto__":3,"x":4,"x":5}',
    );
  });

  it("writes fixed-size lists, empty lists and infinite floats as JSON", () => {
    const pair = makeData({
      type: new FixedSizeList(2, new Field("item", new Int32())),
      length: 1,
      nullCount: 0,
      child: makeData({ type: new Int32(), data: Int32Array.of(1, 2) }),
    });
    expect(firstCell(makeVector(pair))).toBe("[1,2]");
    expect(cell([[]], listOf(new Int32()))).toBe("[]");
    expect(cell([[Infinity, -Infinity, 0.5]], listOf(new Float64()))).toBe(
      '["Infinity","-Infinity",0.5]',
    );
  });

  it("writes durations inside a list as numbers, in full", () => {
    expect(cell([[5n, 2n ** 60n]], listOf(new DurationMillisecond()))).toBe(
      "[5,1152921504606846976]",
    );
  });

  it("writes map keys of any type as JSON strings, and null values as null", () => {
    const map = new Map_<Int32, Utf8>(
      new Field(
        "entries",
        new Struct([new Field("key", new Int32(), false), new Field("value", new Utf8())]),
      ),
    );
    expect(
      cell(
        [
          new Map([
            [1, "a"],
            [2, null],
          ]),
        ],
        map,
      ),
    ).toBe('{"1":"a","2":null}');
  });

  it("shows large binary values the way DuckDB writes a BLOB", () => {
    expect(cell([new Uint8Array([0x41, 0x00])], new LargeBinary())).toBe("A\\x00");
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

describe("displayFor", () => {
  /** What a one-column result's first cell of `type` shows in the table, for a reader in `locale`. */
  function shown(values: unknown[], type: DataType, locale = "en-US") {
    const text = cell(values, type);
    return text == null ? text : displayFor(type, locale)(text);
  }

  it("groups the thousands of integers", () => {
    expect(shown([10080n], new Int64())).toBe("10,080");
    expect(shown([9223372036854775807n], new Int64())).toBe("9,223,372,036,854,775,807");
    expect(shown([-1234], new Int32())).toBe("-1,234");
  });

  it("groups digits as the reader's locale does", () => {
    expect(shown([1048576], new Int32(), "en-IN")).toBe("10,48,576");
  });

  it("shows floats to two decimal places or six significant digits, never rounding the whole part", () => {
    expect(shown([2039741.1799999988], new Float64())).toBe("2,039,741.18");
    expect(shown([0.000123456789], new Float64())).toBe("0.000123457");
    expect(shown([1.5], new Float64())).toBe("1.5");
  });

  it("leaves NaN and infinities alone", () => {
    expect(shown([Number.NaN], new Float64())).toBe("NaN");
    expect(shown([Number.POSITIVE_INFINITY], new Float64())).toBe("Infinity");
    expect(shown([Number.NEGATIVE_INFINITY], new Float64())).toBe("-Infinity");
  });

  it("groups a decimal's whole part and keeps its scale", () => {
    const type = new Decimal(2, 18, 128);
    const words = new Uint32Array(4);
    new BigInt64Array(words.buffer)[0] = -123456750n;
    new BigInt64Array(words.buffer)[1] = -1n;
    const text = firstCell(makeVector(makeData({ type, length: 1, nullCount: 0, data: words })));
    expect(text).toBe("-1234567.50");
    expect(displayFor(type, "en-US")(text ?? "")).toBe("-1,234,567.50");
  });

  it("leaves text that isn't a number alone", () => {
    expect(shown(["10080"], new Utf8())).toBe("10080");
  });

  it("leaves the cell's own text in full, for copying and exporting", () => {
    expect(cell([2039741.1799999988], new Float64())).toBe("2039741.1799999988");
  });
});
