// The landing page shows pieces of the workbench as plain HTML. These tests fail when the app
// changes what it shows and the page doesn't follow.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tableNameFor } from "@/features/catalog/formats";
import { describeError, lineAt, parseEngineError } from "@/features/results/engine-error";
import { encodeShareLink } from "@/features/share/share-link";
import { templates } from "@/features/templates/registry";

// Relative to the repository root, where Vitest runs.
const html = readFileSync("index.html", "utf8");

/** The page's text as a reader sees it, without tags. */
const text = html
  .replace(/<[^>]*>/g, " ")
  .replaceAll("&#39;", "'")
  .replaceAll("&quot;", '"')
  .replaceAll("&amp;", "&")
  .replace(/\s+/g, " ");

describe("the landing page", () => {
  it("lists every analysis template by its title", () => {
    for (const template of templates) expect(text).toContain(template.title);
  });

  it("names each sample file's table the way the workbench does", () => {
    for (const file of ["Machine log October.csv", "Orders 2024.parquet", "Breakdowns.xlsx"]) {
      expect(text).toContain(`${tableNameFor(file, new Set())} `);
      expect(text).toContain(` ${file}`);
    }
  });

  it("words its sample error as the workbench's error panel does", () => {
    const sql = "SELECT *\nFROM shipment";
    const duckdb = `{"exception_type":"Catalog","exception_message":"Table with name shipment does not exist!\\nDid you mean \\"shipments\\"?","name":"shipment","position":"14","type":"Table","error_subtype":"MISSING_ENTRY","candidates":"shipments"}`;
    const error = parseEngineError(new Error(duckdb), sql);
    const { title, hint, label } = describeError(error);
    const line = lineAt(sql, error.position ?? -1);

    expect(text).toContain(title);
    expect(text).toContain(hint);
    expect(text).toContain(label);
    expect(text).toContain(`Line ${line.number}`);
    expect(html).toContain(`<pre>${line.text}\n`);
    expect(html).toContain(`${" ".repeat(line.column)}^</span></pre>`);
  });

  it("shows a share link the workbench would make for its downtime Pareto", () => {
    const link = encodeShareLink({
      sql: "SELECT reason, date_diff('minute', started_at, ended_at) AS downtime_min\nFROM breakdowns",
      chart: { type: "pareto", x: "reason", y: "downtime_min", aggregate: "sum" },
    });
    expect(html).toContain(`value="https://blinkql.karthik.nz/app/${link}"`);
  });
});
