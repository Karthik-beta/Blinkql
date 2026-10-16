import type { EditorState } from "@codemirror/state";

/** What Run runs: the selected text if there is a selection, otherwise the whole editor. */
export function sqlToRun(state: EditorState): string {
  const { main } = state.selection;
  const text = main.empty ? state.doc.toString() : state.sliceDoc(main.from, main.to);
  return text.trim();
}
