// A wavy underline under the part of the SQL an error points at. It goes away on the next edit,
// since the text it marked may no longer be there.
import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/** Marks `from`–`to` as the error, or clears the mark with null. */
export const setErrorMark = StateEffect.define<{ from: number; to: number } | null>();

const mark = Decoration.mark({ class: "cm-error-mark" });

const errorMarkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setErrorMark)) {
        const range = effect.value;
        return range ? Decoration.set([mark.range(range.from, range.to)]) : Decoration.none;
      }
    }
    return transaction.docChanged ? Decoration.none : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Whether something is marked as the error. */
export function hasErrorMark(state: EditorState): boolean {
  return state.field(errorMarkField, false)?.size !== 0;
}

export const errorMark: Extension = [
  errorMarkField,
  EditorView.baseTheme({
    ".cm-error-mark": {
      textDecoration: "underline wavy var(--destructive)",
      textDecorationSkipInk: "none",
      textUnderlineOffset: "3px",
    },
  }),
];
