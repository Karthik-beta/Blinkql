import { describe, expect, it } from "vitest";
import { decodeShareLink, encodeShareLink, SHARE_PREFIX } from "./share-link";

/** `text`, read as bytes, in base64url without padding, to craft links by hand. */
const base64url = (text: string) =>
  btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

describe("share links", () => {
  it("round-trips a query and its chart settings", () => {
    const payload = {
      sql: "SELECT machine_id, avg(v) AS v FROM readings GROUP BY 1",
      chart: { type: "bar" as const, x: "machine_id", y: "v", aggregate: "avg" as const },
    };
    const fragment = encodeShareLink(payload);
    expect(fragment.startsWith(`${SHARE_PREFIX}1.`)).toBe(true);
    expect(decodeShareLink(fragment)).toEqual(payload);
  });

  it("round-trips a query without a chart", () => {
    expect(decodeShareLink(encodeShareLink({ sql: "SELECT 1" }))).toEqual({ sql: "SELECT 1" });
  });

  it("keeps text outside ASCII and uses only URL-safe characters", () => {
    const sql = "SELECT 'Größe 🚀' AS \"名前\" -- ünïcode\nFROM t";
    const fragment = encodeShareLink({ sql });
    expect(fragment.slice(SHARE_PREFIX.length)).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(decodeShareLink(fragment)).toEqual({ sql });
  });

  it("rejects a link of another version", () => {
    const fragment = encodeShareLink({ sql: "SELECT 1" });
    expect(decodeShareLink(fragment.replace(`${SHARE_PREFIX}1.`, `${SHARE_PREFIX}2.`))).toBeNull();
  });

  it.each([
    ["no share link", "#other"],
    ["no version", `${SHARE_PREFIX}eyJzcWwiOiJTRUxFQ1QgMSJ9`],
    ["text that isn't base64url", `${SHARE_PREFIX}1.not base64!`],
    ["base64url that isn't JSON", `${SHARE_PREFIX}1.${base64url("SELECT 1")}`],
    ["JSON without SQL", `${SHARE_PREFIX}1.${base64url('{"chart":{"type":"bar","x":"a"}}')}`],
    ["empty SQL", `${SHARE_PREFIX}1.${base64url('{"sql":""}')}`],
    [
      "an unknown chart type",
      `${SHARE_PREFIX}1.${base64url('{"sql":"S","chart":{"type":"pie","x":"a"}}')}`,
    ],
    [
      "an unknown aggregate",
      `${SHARE_PREFIX}1.${base64url('{"sql":"S","chart":{"type":"bar","x":"a","aggregate":"median"}}')}`,
    ],
    ["bytes that aren't UTF-8", `${SHARE_PREFIX}1.${base64url("\xff\xfe")}`],
  ])("rejects %s", (_, fragment) => {
    expect(decodeShareLink(fragment)).toBeNull();
  });

  it("drops fields it doesn't know", () => {
    const fragment = `${SHARE_PREFIX}1.${base64url('{"sql":"SELECT 1","rows":[[1]],"chart":{"type":"line","x":"a","extra":1}}')}`;
    expect(decodeShareLink(fragment)).toEqual({ sql: "SELECT 1", chart: { type: "line", x: "a" } });
  });
});
