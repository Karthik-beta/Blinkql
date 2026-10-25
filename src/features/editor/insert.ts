// Lets other parts of the workbench, such as the schema browser, type into the SQL editor.

type Inserter = (text: string) => void;

let inserter: Inserter | null = null;

/** Sets what insertIntoEditor() calls; the editor sets itself while it's on the page. */
export function setEditorInserter(next: Inserter | null): void {
  inserter = next;
}

/** Inserts `text` at the editor's cursor, replacing the selection. Does nothing without an editor. */
export function insertIntoEditor(text: string): void {
  inserter?.(text);
}
