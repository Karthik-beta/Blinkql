import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { sqlToRun } from "./sql-to-run";

const doc = "SELECT 1;\nSELECT 2;\n";

describe("sqlToRun", () => {
  it("runs the whole editor when nothing is selected", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(3) });
    expect(sqlToRun(state)).toEqual({ sql: "SELECT 1;\nSELECT 2;", from: 0 });
  });

  it("runs only the selection when there is one", () => {
    const state = EditorState.create({ doc, selection: EditorSelection.range(10, 19) });
    expect(sqlToRun(state)).toEqual({ sql: "SELECT 2;", from: 10 });
  });

  it("gives nothing to run for an empty editor", () => {
    expect(sqlToRun(EditorState.create({ doc: "  \n" }))).toEqual({ sql: "", from: 0 });
  });

  it("says where the SQL starts once surrounding whitespace is trimmed", () => {
    const state = EditorState.create({
      doc: "\n  SELECT 3;  ",
      selection: EditorSelection.cursor(0),
    });
    expect(sqlToRun(state)).toEqual({ sql: "SELECT 3;", from: 3 });

    const selected = EditorState.create({ doc, selection: EditorSelection.range(9, 19) });
    expect(sqlToRun(selected)).toEqual({ sql: "SELECT 2;", from: 10 });
  });
});
