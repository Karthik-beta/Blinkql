import { afterEach, describe, expect, it } from "vitest";
import { markOnce, marks, measureSince, measures, recordCommit } from "./user-timing";

describe("markOnce", () => {
  afterEach(() => {
    performance.clearMarks();
  });

  it("records the mark", () => {
    markOnce(marks.appShell);

    expect(performance.getEntriesByName(marks.appShell, "mark")).toHaveLength(1);
  });

  it("keeps the first mark when called again", () => {
    markOnce(marks.appShell);
    const [first] = performance.getEntriesByName(marks.appShell, "mark");
    markOnce(marks.appShell);

    expect(performance.getEntriesByName(marks.appShell, "mark")).toEqual([first]);
  });
});

describe("measureSince", () => {
  afterEach(() => {
    performance.clearMeasures();
  });

  it("records a span from the start time until now", () => {
    const start = performance.now();
    measureSince(measures.query, start);

    const [entry] = performance.getEntriesByName(measures.query, "measure");
    expect(entry?.startTime).toBe(start);
    expect(entry?.duration).toBeGreaterThanOrEqual(0);
  });

  it("records every call", () => {
    measureSince(measures.query, performance.now());
    measureSince(measures.query, performance.now());

    expect(performance.getEntriesByName(measures.query, "measure")).toHaveLength(2);
  });
});

describe("recordCommit", () => {
  afterEach(() => {
    performance.clearMeasures();
  });

  it("records how long React rendered the profiled tree, and which tree", () => {
    recordCommit("results", "update", 12.5, 30, 100, 115);

    const [entry] = performance.getEntriesByName(measures.reactCommit, "measure");
    expect(entry).toMatchObject({
      startTime: 100,
      duration: 12.5,
      detail: { id: "results", phase: "update" },
    });
  });
});
