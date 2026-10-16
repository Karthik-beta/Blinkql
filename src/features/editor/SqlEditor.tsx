import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
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
import { duckdbSql } from "./language";
import { runShortcut } from "./shortcut";
import { sqlToRun } from "./sql-to-run";
import { blinkqlEditorTheme } from "./theme";

export type SqlEditorHandle = {
  /** The SQL that Run would run right now: the selection, or the whole editor. */
  sqlToRun(): string;
};

type Props = {
  ref?: Ref<SqlEditorHandle>;
  /** Called with the SQL to run when the user presses Ctrl/Cmd + Enter. */
  onRun: (sql: string) => void;
};

export function SqlEditor({ ref, onRun }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The editor is created once; it calls the latest onRun through this ref.
  const latestOnRun = useRef(onRun);
  useEffect(() => {
    latestOnRun.current = onRun;
  }, [onRun]);

  useImperativeHandle(ref, () => ({
    sqlToRun: () => (view.current ? sqlToRun(view.current.state) : ""),
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
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  return <div ref={host} data-sql-editor className="min-h-0 flex-1 overflow-hidden" />;
}
