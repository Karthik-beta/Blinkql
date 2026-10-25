import { autocompletion, closeCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { errorMark, hasErrorMark, setErrorMark } from "./error-mark";
import { setEditorContents, setEditorInserter } from "./insert";
import { duckdbSql } from "./language";
import { runShortcut } from "./shortcut";
import { type SqlToRun, sqlToRun } from "./sql-to-run";
import { blinkqlEditorTheme } from "./theme";

/** Part of SQL that ran from `from` in the editor: `start`–`end` within `sql`. */
export type SqlRange = SqlToRun & { start: number; end: number };

export type SqlEditorHandle = {
  /** The SQL that Run would run right now: the selection, or the whole editor. */
  sqlToRun(): SqlToRun;
  /**
   * Underlines `range` in the editor. Returns false, and marks nothing, if the editor no longer
   * holds that SQL where it ran from.
   */
  markError(range: SqlRange): boolean;
  /** Moves the cursor to the start of `range`, scrolls it into view and focuses the editor. */
  goTo(range: SqlRange): void;
  /** Removes the error underline. */
  clearError(): void;
};

type Props = {
  ref?: Ref<SqlEditorHandle>;
  /** Called with the SQL to run when the user presses Ctrl/Cmd + Enter. */
  onRun: (run: SqlToRun) => void;
};

/** Where `range` is in the editor now, or null if the editor no longer holds that SQL there. */
function locate(view: EditorView, { sql, from, start, end }: SqlRange) {
  if (view.state.sliceDoc(from, from + sql.length) !== sql) return null;
  return { from: from + start, to: from + end };
}

export function SqlEditor({ ref, onRun }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The editor is created once; it calls the latest onRun through this ref.
  const latestOnRun = useRef(onRun);
  useEffect(() => {
    latestOnRun.current = onRun;
  }, [onRun]);

  useImperativeHandle(ref, () => ({
    sqlToRun: () => (view.current ? sqlToRun(view.current.state) : { sql: "", from: 0 }),
    markError(range) {
      const target = view.current && locate(view.current, range);
      if (!view.current || !target) return false;
      view.current.dispatch({ effects: setErrorMark.of(target) });
      return true;
    },
    goTo(range) {
      const target = view.current && locate(view.current, range);
      if (!view.current || !target) return;
      view.current.dispatch({
        selection: EditorSelection.cursor(target.from),
        effects: EditorView.scrollIntoView(target.from, { y: "center" }),
      });
      view.current.focus();
    },
    clearError() {
      if (view.current && hasErrorMark(view.current.state)) {
        view.current.dispatch({ effects: setErrorMark.of(null) });
      }
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    // The editor lives in a shadow root. CodeMirror injects its styles at runtime, and in a
    // document it does that with a <style> tag, which our Content Security Policy blocks
    // (style-src 'self'). In a shadow root it uses a constructed stylesheet instead, which CSP
    // allows. Theme variables and fonts still reach in: custom properties inherit through it.
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
    const editor = new EditorView({
      parent: root,
      root,
      state: EditorState.create({
        extensions: [
          // Highest precedence: the default keymap binds Mod-Enter to "insert blank line".
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: (target) => {
                  // Otherwise completions still being looked up would take the Escape that cancels.
                  closeCompletion(target);
                  latestOnRun.current(sqlToRun(target.state));
                  return true;
                },
              },
            ]),
          ),
          // No Tab binding: Tab moves focus out of the editor, as it does everywhere else.
          keymap.of([...defaultKeymap, ...historyKeymap]),
          history(),
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          duckdbSql(),
          autocompletion(),
          errorMark,
          blinkqlEditorTheme,
          placeholder(`Write SQL here. ${runShortcut.label} runs it, or just the selected part.`),
          EditorView.contentAttributes.of({
            "aria-label": "SQL editor",
            "aria-keyshortcuts": runShortcut.aria,
          }),
        ],
      }),
    });
    view.current = editor;
    setEditorInserter((text) => editor.dispatch(editor.state.replaceSelection(text)));
    setEditorContents({
      get: () => editor.state.doc.toString(),
      replace: (text) =>
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
          selection: EditorSelection.cursor(text.length),
        }),
    });
    return () => {
      setEditorInserter(null);
      setEditorContents(null);
      editor.destroy();
      view.current = null;
    };
  }, []);

  return <div ref={host} data-sql-editor className="min-h-0 flex-1 overflow-hidden" />;
}
