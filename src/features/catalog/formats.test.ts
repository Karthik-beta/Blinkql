import { describe, expect, it } from "vitest";
import {
  acceptedExtensions,
  detectFormat,
  quoteIdentifier,
  readerFor,
  tableNameFor,
} from "./formats";

describe("detectFormat", () => {
  it.each([
    ["orders.csv", "csv"],
    ["tabs.TSV", "csv"],
    ["events.parquet", "parquet"],
    ["shifts.json", "json"],
    ["alarms.jsonl", "jsonl"],
    ["alarms.ndjson", "jsonl"],
  ])("reads %s as %s", (fileName, format) => {
    expect(detectFormat(fileName)).toBe(format);
  });

  it.each(["notes.txt", "README", ".csv", "archive.csv.gz"])("rejects %s", (fileName) => {
    expect(detectFormat(fileName)).toBeNull();
  });

  it("lists every accepted extension for the file picker", () => {
    expect(acceptedExtensions).toBe(".csv,.tsv,.parquet,.json,.jsonl,.ndjson");
  });
});

describe("tableNameFor", () => {
  const none = new Set<string>();

  it.each([
    ["orders.csv", "orders"],
    ["Machine Events (March).csv", "machine_events_march"],
    ["2024-sales.parquet", "t_2024_sales"],
    ["données.json", "donn_es"],
    ["---.csv", "table"],
    ["a.b.csv", "a_b"],
  ])("names %s %s", (fileName, name) => {
    expect(tableNameFor(fileName, none)).toBe(name);
  });

  it("adds a suffix when the name is taken", () => {
    expect(tableNameFor("orders.csv", new Set(["orders"]))).toBe("orders_2");
    expect(tableNameFor("orders.csv", new Set(["orders", "orders_2"]))).toBe("orders_3");
  });
});

describe("SQL", () => {
  it("quotes identifiers", () => {
    expect(quoteIdentifier('say "hi"')).toBe('"say ""hi"""');
  });

  it("reads each format with the matching table function", () => {
    expect(readerFor("csv", "orders.csv")).toBe("read_csv('orders.csv')");
    expect(readerFor("parquet", "o.parquet")).toBe("read_parquet('o.parquet')");
    expect(readerFor("json", "s.json")).toBe("read_json('s.json')");
    expect(readerFor("jsonl", "a.jsonl")).toBe(
      "read_json('a.jsonl', format = 'newline_delimited')",
    );
    expect(readerFor("csv", "it's.csv")).toBe("read_csv('it''s.csv')");
  });
});
