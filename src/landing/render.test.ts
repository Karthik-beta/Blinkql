// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderGrid, shortVersion } from "./render.ts";
import { sampleQuery, sampleRows } from "./sample.ts";

describe("results grid", () => {
  const html = renderGrid();

  it("renders every sample row and says how many rows the query returned", () => {
    expect(html.match(/<tr>/g)).toHaveLength(sampleRows.length + 1);
    expect(html).toContain(`The first ${sampleRows.length} of ${sampleQuery.rowCount} rows`);
  });

  it("shows NULL the way the grid will, distinct from an empty value", () => {
    expect(html).toContain('<td><span class="null">NULL</span></td>');
  });

  it("right-aligns numbers, not text or dates, and shows engine type names", () => {
    expect(html).toContain("<td>Europe</td>");
    expect(html).toContain('<td class="show-from-1024">2026-10-01</td>');
    expect(html).toContain('<td class="num">564053.39</td>');
    expect(html).toContain('<td class="num show-from-480">0.061</td>');
    expect(html).toContain('<span class="col-type">DECIMAL(38,2)</span>');
  });

  it("escapes what a cell holds", () => {
    expect(renderGrid([["<b>&</b>", null, null, null, null, null]], 1)).toContain(
      "<td>&lt;b&gt;&amp;&lt;/b&gt;</td>",
    );
  });
});

describe("shortVersion", () => {
  it("shows major.minor, so a patch release reads the same", () => {
    expect(shortVersion("1.0.0")).toBe("1.0");
    expect(shortVersion("1.0.3")).toBe("1.0");
    expect(shortVersion("12.4.0-rc.1")).toBe("12.4");
  });

  it("rejects a version that isn't semantic", () => {
    expect(() => shortVersion("1.0")).toThrow();
  });
});
