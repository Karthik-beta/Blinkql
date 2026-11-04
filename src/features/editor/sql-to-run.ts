import type { EditorState } from "@codemirror/state";

export type SqlToRun = {
  /** The SQL, without surrounding whitespace. */
  sql: string;
  /** Where `sql` starts in the editor, so positions in it can be mapped back. */
  from: number;
};

/** What Run runs: the selected text if there is a selection, otherwise the whole editor. */
export function sqlToRun(state: EditorState): SqlToRun {
  const { main } = state.selection;
  const start = main.empty ? 0 : main.from;
  const text = main.empty ? state.doc.toString() : state.sliceDoc(main.from, main.to);
  const sql = text.trim();
  return { sql, from: sql ? start + text.indexOf(sql) : start };
}
