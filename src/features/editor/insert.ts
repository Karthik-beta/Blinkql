// Lets other parts of the workbench, such as the schema browser or the query history, type into
// the SQL editor, read what's in it and move the keyboard focus to it.

type Inserter = (text: string) => void;

/** The editor's whole text, to read and to replace. */
type Contents = { get(): string; replace(text: string): void };

let inserter: Inserter | null = null;
let contents: Contents | null = null;
/**
 * The text sent while there's no editor, such as while it loads (QueryPanel.tsx). The next
 * editor starts with it, so a template or history entry picked early isn't lost.
 */
let pending = "";

/** Sets what insertIntoEditor() calls; the editor sets itself while it's on the page. */
export function setEditorInserter(next: Inserter | null): void {
  inserter = next;
}

/** Inserts `text` at the editor's cursor, replacing the selection; without an editor, appends it. */
export function insertIntoEditor(text: string): void {
  if (inserter) inserter(text);
  else pending += text;
}

/** Sets what editorContents() and replaceEditorContents() use; the editor sets itself. */
export function setEditorContents(next: Contents | null): void {
  contents = next;
  if (next && pending) {
    next.replace(pending);
    pending = "";
  }
}

/** All the SQL in the editor, or what's waiting for one. */
export function editorContents(): string {
  return contents ? contents.get() : pending;
}

/** Replaces everything in the editor, or what's waiting for one, with `text`. */
export function replaceEditorContents(text: string): void {
  if (contents) contents.replace(text);
  else pending = text;
}

let focuser: (() => void) | null = null;

/** Sets what focusEditor() calls; the editor sets itself while it's on the page. */
export function setEditorFocuser(next: (() => void) | null): void {
  focuser = next;
}

/** Moves the keyboard focus to the editor, if there is one. */
export function focusEditor(): void {
  focuser?.();
}
