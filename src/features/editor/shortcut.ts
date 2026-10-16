// CodeMirror's "Mod" is Cmd on Apple devices and Ctrl elsewhere; the labels follow suit.
const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

export const runShortcut = apple
  ? { label: "⌘ Enter", keys: "⌘↵", aria: "Meta+Enter" }
  : { label: "Ctrl+Enter", keys: "Ctrl ↵", aria: "Control+Enter" };
