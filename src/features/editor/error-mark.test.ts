import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { errorMark, hasErrorMark, setErrorMark } from "./error-mark";

const doc = "SELECT 1;\nSELECT 2;\n";

/** A state with `SELECT 2` (offsets 10–18) marked as the error. */
function markedState(): EditorState {
  const state = EditorState.create({ doc, extensions: errorMark });
  return state.update({ effects: setErrorMark.of({ from: 10, to: 18 }) }).state;
}

describe("error mark", () => {
  it("is absent until something marks it", () => {
    expect(hasErrorMark(EditorState.create({ doc, extensions: errorMark }))).toBe(false);
  });

  it("marks the range it's given", () => {
    expect(hasErrorMark(markedState())).toBe(true);
  });

  it("is cleared by setting it to null", () => {
    const cleared = markedState().update({ effects: setErrorMark.of(null) }).state;
    expect(hasErrorMark(cleared)).toBe(false);
  });

  it("is cleared by any document change", () => {
    const edited = markedState().update({ changes: { from: 0, insert: "-- " } }).state;
    expect(hasErrorMark(edited)).toBe(false);
  });

  it("is kept by a transaction that changes neither the document nor the mark", () => {
    const moved = markedState().update({ selection: { anchor: 0 } }).state;
    expect(hasErrorMark(moved)).toBe(true);
  });
});
