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
    expect(html).toContain('<span class="null">NULL</span>');
  });

  it("shows an OEE that is availability × performance × quality, NULL when quality is", () => {
    for (const [, , availability, performance, quality, oee] of sampleRows) {
      if (quality === null) expect(oee).toBeNull();
      else expect(oee).toBeCloseTo(availability * performance * quality, 3);
    }
  });

  it("right-aligns numbers and shows engine type names", () => {
    expect(html).toContain('<td class="num">0.612</td>');
    expect(html).toContain('<span class="col-type">DOUBLE</span>');
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
