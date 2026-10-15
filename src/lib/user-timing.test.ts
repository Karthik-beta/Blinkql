import { afterEach, describe, expect, it } from "vitest";
import { markOnce, marks } from "./user-timing";

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
