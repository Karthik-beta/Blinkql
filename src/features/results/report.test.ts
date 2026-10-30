import { describe, expect, it } from "vitest";
import { REPORT_ROWS, type Report, reportHtml } from "./report";

const createdAt = new Date("2026-10-29T09:05:03Z");

function report(overrides: Partial<Report> = {}): Report {
  return {
    title: "Blinkql report",
    createdAt,
    sql: "SELECT plant_code, capacity FROM plants",
    columns: [
      { name: "plant_code", numeric: false },
      { name: "capacity", numeric: true },
    ],
    rows: [
      ["P01", "120"],
      ["P02", null],
    ],
    rowCount: 2,
    chart: null,
    ...overrides,
  };
}

/** The report as the browser reads it. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function bodyRows(doc: Document): string[][] {
  return [...doc.querySelectorAll("tbody tr")].map((row) =>
    [...row.children].map((cell) => cell.textContent ?? ""),
  );
}

describe("reportHtml", () => {
  it("is a complete document that can't load anything from elsewhere", () => {
    const html = reportHtml(report());
    const doc = parse(html);

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(doc.documentElement.lang).toBe("en");
    expect(doc.querySelector("meta[charset]")?.getAttribute("charset")).toBe("utf-8");
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
      "width=device-width, initial-scale=1",
    );
    const policy = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content");
    expect(policy).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    expect(doc.title).toBe("Blinkql report");
    expect(doc.querySelectorAll("script, link, iframe, object, embed")).toHaveLength(0);
    expect(doc.querySelector("style")?.textContent).toContain("prefers-color-scheme: dark");
    expect(doc.querySelector("style")?.textContent).toContain("@media print");
  });

  it("shows the SQL, when it was made and the result as a table with headers", () => {
    const doc = parse(reportHtml(report()));

    expect(doc.querySelector("h1")?.textContent).toBe("Blinkql report");
    expect(doc.querySelector("pre > code")?.textContent).toBe(
      "SELECT plant_code, capacity FROM plants",
    );
    expect(doc.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-29T09:05:03.000Z");
    const headers = [...doc.querySelectorAll("thead th")];
    expect(headers.map((th) => th.textContent)).toEqual(["plant_code", "capacity"]);
    expect(headers.map((th) => th.getAttribute("scope"))).toEqual(["col", "col"]);
    expect(doc.querySelector("caption")?.textContent).toBe("Result: 2 rows");
    expect(bodyRows(doc)).toEqual([
      ["P01", "120"],
      ["P02", "NULL"],
    ]);
  });

  it("lines numbers up on the right and marks NULLs, as the workbench does", () => {
    const doc = parse(reportHtml(report()));
    const [first, second] = doc.querySelectorAll("tbody tr");

    expect(first?.children[0]?.className).toBe("");
    expect(first?.children[1]?.className).toBe("number");
    expect(second?.children[1]?.className).toBe("number null");
  });

  it("escapes every value it's given", () => {
    const hostile = `<script>alert("x")</script>'&`;
    const html = reportHtml(
      report({
        title: hostile,
        sql: `SELECT '${hostile}' AS "a<b>"`,
        columns: [{ name: `"><img src=x onerror=alert(1)>`, numeric: false }],
        rows: [[hostile]],
        rowCount: 1,
        chart: {
          light: `data:image/png;base64,AAAA" onload="alert(1)`,
          dark: `data:image/png;base64,BBBB" onload="alert(1)`,
          description: hostile,
        },
      }),
    );
    const doc = parse(html);

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.querySelectorAll("img")).toHaveLength(2);
    expect(doc.querySelectorAll("img[onload]")).toHaveLength(0);
    expect(doc.title).toBe(hostile);
    expect(doc.querySelector("h1")?.textContent).toBe(hostile);
    expect(doc.querySelector("pre > code")?.textContent).toBe(`SELECT '${hostile}' AS "a<b>"`);
    expect(doc.querySelector("thead th")?.textContent).toBe(`"><img src=x onerror=alert(1)>`);
    expect(bodyRows(doc)).toEqual([[hostile]]);
    for (const image of doc.querySelectorAll("img")) {
      expect(image.getAttribute("alt")).toBe(hostile);
    }
  });

  it(`shows only the first ${REPORT_ROWS} rows of a larger result, and says so`, () => {
    const rows = Array.from({ length: 1_500 }, (_, i) => [String(i), String(i * 2)]);
    const doc = parse(reportHtml(report({ rows, rowCount: 2_500 })));

    expect(REPORT_ROWS).toBe(1_000);
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(1_000);
    expect(bodyRows(doc).at(-1)).toEqual(["999", "1998"]);
    expect(doc.querySelector("caption")?.textContent).toBe("Result: first 1,000 of 2,500 rows");
  });

  it("shows every row of a result of exactly 1,000 rows", () => {
    const rows = Array.from({ length: 1_000 }, (_, i) => [String(i), "1"]);
    const doc = parse(reportHtml(report({ rows, rowCount: 1_000 })));

    expect(doc.querySelectorAll("tbody tr")).toHaveLength(1_000);
    expect(doc.querySelector("caption")?.textContent).toBe("Result: 1,000 rows");
  });

  it("has no chart section when no chart is shown", () => {
    const doc = parse(reportHtml(report({ chart: null })));

    expect(doc.querySelector("img")).toBeNull();
    expect([...doc.querySelectorAll("h2")].map((h2) => h2.textContent)).toEqual([
      "Query",
      "Result",
    ]);
  });

  it("shows the chart as an image described by its text summary, in the page's colours", () => {
    const light = "data:image/png;base64,iVBORw0KGgo=";
    const dark = "data:image/png;base64,iVBORw0KGgp=";
    const description = "Bar chart of count(*) by k, 3 bars, highest 10 (0), lowest 10 (1)";
    const doc = parse(reportHtml(report({ chart: { light, dark, description } })));

    const images = [...doc.querySelectorAll("figure img")];
    expect(images.map((image) => [image.className, image.getAttribute("src")])).toEqual([
      ["light", light],
      ["dark", dark],
    ]);
    for (const image of images) expect(image.getAttribute("alt")).toBe(description);
    // The light one shows unless the page is dark (e2e/export.spec.ts checks which one shows).
    expect(doc.querySelector("style")?.textContent).toContain("img.dark { display: none; }");
    expect([...doc.querySelectorAll("h2")].map((h2) => h2.textContent)).toEqual([
      "Query",
      "Chart",
      "Result",
    ]);
  });

  it("links back to Blinkql", () => {
    const doc = parse(reportHtml(report()));

    expect(doc.querySelector("footer a")?.getAttribute("href")).toBe("https://blinkql.karthik.nz");
  });
});
