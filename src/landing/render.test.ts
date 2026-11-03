// @vitest-environment node
import { describe, expect, it } from "vitest";
import { milestones } from "./milestones.ts";
import { renderGrid, renderMilestones } from "./render.ts";
import { sampleQuery, sampleRows } from "./sample.ts";

describe("milestones", () => {
  it("lists M0 to M7 in order, every one done for version 1.0", () => {
    expect(milestones.map((m) => m.code)).toEqual(["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7"]);
    expect(milestones.filter((m) => m.status !== "done")).toEqual([]);
  });

  it("labels every lamp in words and marks the current step", () => {
    const html = renderMilestones([
      { code: "M0", name: "Foundations", summary: "s", status: "done" },
      { code: "M1", name: "Core query loop", summary: "s", status: "current" },
      { code: "M2", name: "Next", summary: "s", status: "planned" },
    ]);
    expect(html).toContain('data-status="done"');
    expect(html).toContain(">Done<");
    expect(html).toContain('data-status="current" aria-current="step"');
    expect(html).toContain(">In progress<");
    expect(html).toContain(">Planned<");
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });
});

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
