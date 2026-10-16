import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { sqlToRun } from "./sql-to-run";

const doc = "SELECT 1;\nSELECT 2;\n";

describe("sqlToRun", () => {
  it("runs the whole editor when nothing is selected", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(3) });
    expect(sqlToRun(state)).toBe("SELECT 1;\nSELECT 2;");
  });

  it("runs only the selection when there is one", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.range(10, 19) });
    expect(sqlToRun(state)).toBe("SELECT 2;");
  });

  it("gives nothing to run for an empty editor", () => {
    expect(sqlToRun(EditorState.create({ doc: "  \n" }))).toBe("");
  });
});
