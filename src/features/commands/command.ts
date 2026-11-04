import { apple } from "@/features/editor/shortcut";

/** Something the user can do from the command palette. */
export type Command = {
  id: string;
  label: string;
  /** Keys that do the same, as shown to the user, e.g. "Ctrl+Enter". */
  shortcut?: string;
  run: () => void;
  /** Listed, but can't run right now, e.g. exporting before there's a result. */
  disabled?: boolean;
};

export const paletteShortcut = apple
  ? { label: "⌘ K", keys: "⌘K", aria: "Meta+K" }
  : { label: "Ctrl+K", keys: "Ctrl K", aria: "Control+K" };

/**
 * Whether `event` is the palette's shortcut: Ctrl+K, or ⌘K on Apple devices, with no other
 * modifier. It needs Ctrl or ⌘ so screen readers, which use plain letters to move around the
 * page, keep them.
 */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
}
