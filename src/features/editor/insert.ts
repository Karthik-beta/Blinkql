// Lets other parts of the workbench, such as the schema browser or the query history, type into
// the SQL editor and read what's in it.

type Inserter = (text: string) => void;

/** The editor's whole text, to read and to replace. */
type Contents = { get(): string; replace(text: string): void };

let inserter: Inserter | null = null;
let contents: Contents | null = null;

/** Sets what insertIntoEditor() calls; the editor sets itself while it's on the page. */
export function setEditorInserter(next: Inserter | null): void {
  inserter = next;
}

/** Inserts `text` at the editor's cursor, replacing the selection. Does nothing without an editor. */
export function insertIntoEditor(text: string): void {
  inserter?.(text);
}

/** Sets what editorContents() and replaceEditorContents() use; the editor sets itself. */
export function setEditorContents(next: Contents | null): void {
  contents = next;
}

/** All the SQL in the editor, or "" without an editor. */
export function editorContents(): string {
  return contents?.get() ?? "";
}

/** Replaces everything in the editor with `text`. Does nothing without an editor. */
export function replaceEditorContents(text: string): void {
  contents?.replace(text);
}
