/** Whether this is an Apple device, where CodeMirror's "Mod" and the labels below mean ⌘. */
export const apple =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export const runShortcut = apple
  ? { label: "⌘ Enter", keys: "⌘↵", aria: "Meta+Enter" }
  : { label: "Ctrl+Enter", keys: "Ctrl ↵", aria: "Control+Enter" };
