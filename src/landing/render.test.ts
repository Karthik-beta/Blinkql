// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Milestone, milestones } from "./milestones.ts";
import {
  currentMilestone,
  escapeHtml,
  highlightSql,
  inlineWordmark,
  renderGrid,
  renderMilestones,
} from "./render.ts";
import { replayQuery, replayRows } from "./replay-data.ts";

describe("milestones", () => {
  it("has exactly one current milestone, M0 to M7 in order", () => {
    expect(milestones.map((m) => m.code)).toEqual(["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7"]);
    expect(currentMilestone(milestones).code).toBe("M0");
  });

  it("refuses a roadmap with no current milestone", () => {
    const allPlanned: Milestone[] = milestones.map((m) => ({ ...m, status: "planned" }));
    expect(() => currentMilestone(allPlanned)).toThrow(/Exactly one/);
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

describe("SQL highlighting", () => {
  it("colours keywords, functions, strings, numbers and comments", () => {
    const html = highlightSql("SELECT SUM(x) FROM t WHERE d >= '2026-10-01' AND n > 60.0 -- note");
    expect(html).toContain('<span class="sql-keyword">SELECT</span>');
    expect(html).toContain('<span class="sql-function">SUM</span>(x)');
    expect(html).toContain('<span class="sql-string">&#39;2026-10-01&#39;</span>');
    expect(html).toContain('<span class="sql-number">60.0</span>');
    expect(html).toContain('<span class="sql-comment">-- note</span>');
    expect(html).toContain(" t ");
  });

  it("escapes markup", () => {
    expect(highlightSql("x <> '<b>'")).not.toContain("<b>");
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("results grid", () => {
  const html = renderGrid();

  it("renders every replay row and says how many rows the query returned", () => {
    expect(html.match(/<tr>/g)).toHaveLength(replayRows.length + 1);
    expect(html).toContain(`The first ${replayRows.length} of ${replayQuery.rowCount} rows`);
  });

  it("shows NULL the way the grid will, distinct from an empty value", () => {
    expect(html).toContain('<span class="null">NULL</span>');
  });

  it("right-aligns numbers and shows engine type names", () => {
    expect(html).toContain('<td class="num">0.612</td>');
    expect(html).toContain('<span class="col-type">DOUBLE</span>');
  });
});

describe("wordmark", () => {
  const svg = readFileSync(
    new URL("../../brand/logo/blinkql-wordmark-light.svg", import.meta.url),
    "utf8",
  );
  const html = inlineWordmark(svg);

  it("follows the text colour and hides from screen readers (the link has the name)", () => {
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toContain("#1A201B");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });

  it("gives the lamp a halo for the done flash", () => {
    expect(html).toContain('class="wordmark-halo"');
    expect(html).toContain('class="wordmark-lamp"');
  });
});
