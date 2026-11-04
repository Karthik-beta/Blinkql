import { describe, expect, it } from "vitest";
import { isSingleRead } from "./read-only";

describe("isSingleRead", () => {
  it.each([
    "SELECT 1",
    "  select * from t;  ",
    "FROM t LIMIT 10",
    "WITH x AS (SELECT 1) SELECT * FROM x",
    "(SELECT 1) UNION (SELECT 2)",
    "-- the latest\nSELECT * FROM t",
    "/* a; b */ SELECT 'x;y', \"odd;name\" FROM t",
    "SELECT 'update' AS word",
    "DESCRIBE t",
    "SUMMARIZE t",
    "VALUES (1), (2)",
  ])("counts %j as a single read", (sql) => {
    expect(isSingleRead(sql)).toBe(true);
  });

  it.each([
    "INSERT INTO t VALUES (1) RETURNING *",
    "UPDATE t SET a = 1 RETURNING a",
    "CREATE TABLE t AS SELECT 1",
    "SELECT 1; INSERT INTO t VALUES (1)",
    "SELECT 1; SELECT 2",
    "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x",
    "COPY t TO 'out.csv'",
    "",
  ])("doesn't count %j", (sql) => {
    expect(isSingleRead(sql)).toBe(false);
  });
});
