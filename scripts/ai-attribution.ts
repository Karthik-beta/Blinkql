// AI tools credit themselves in commit messages, e.g. a `Co-authored-by: Claude …`
// trailer or a "Generated with Claude Code" line. GitHub copies co-author trailers
// into the squash commit on main, so they're rejected by the commit-msg hook
// (commitlint.config.js) and again on every PR (check-ai-attribution.ts).
// Both patterns match whole attribution lines only, so text that merely
// mentions Claude Code (like this comment) passes.
const patterns = [
  /^co-authored-by:.*\b(?:claude|anthropic)\b/i,
  // "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
  /^\W*generated with \[claude code\]/i,
];

/** The lines of `text` that credit an AI tool, trimmed. */
export function findAiAttribution(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => patterns.some((pattern) => pattern.test(line)));
}
