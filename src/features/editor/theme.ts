// The editor's look, read from the design tokens so it follows the theme without reconfiguring
// (Design Tokens wiki page, section 4).
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const chrome = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--foreground)",
    backgroundColor: "var(--background)",
    fontSize: "14px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "21px" },
  ".cm-content": { caretColor: "var(--primary)" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--muted) 70%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-cursor": { borderLeftColor: "var(--primary)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--selection)",
  },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "10px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--foreground)",
  },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  // Type names are part of the language, like keywords, but lighter so keywords still lead.
  { tag: t.typeName, color: "var(--syntax-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syntax-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--syntax-number)" },
  { tag: [t.function(t.variableName), t.standard(t.name)], color: "var(--syntax-function)" },
  { tag: [t.lineComment, t.blockComment], color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [t.operator, t.punctuation], color: "var(--muted-foreground)" },
]);

export const blinkqlEditorTheme = [chrome, syntaxHighlighting(highlight)];
