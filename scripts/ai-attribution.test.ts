import { describe, expect, it } from "vitest";
import { findAiAttribution } from "./ai-attribution.ts";

describe("findAiAttribution", () => {
  it("finds a trailer line", () => {
    const message = "feat(app): add a thing\n\nCo-authored-by: Claude <noreply@anthropic.com>";

    expect(findAiAttribution(message)).toEqual(["Co-authored-by: Claude <noreply@anthropic.com>"]);
  });

  it("finds a footer line", () => {
    const message =
      "fix(app): correct a count\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";

    expect(findAiAttribution(message)).toEqual([
      "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    ]);
  });

  it("ignores case and spaces around a line", () => {
    const message =
      "fix: a bug\n\n   CO-AUTHORED-BY: claude <x@example.com>   \n  generated WITH [claude code](https://claude.com/claude-code)  ";

    expect(findAiAttribution(message)).toEqual([
      "CO-AUTHORED-BY: claude <x@example.com>",
      "generated WITH [claude code](https://claude.com/claude-code)",
    ]);
  });

  it("doesn't match prose that only mentions a tool", () => {
    const message = [
      "chore: tidy the commit-msg hook",
      "",
      "The hook rejects a Co-authored-by: Claude trailer and a Generated with Claude Code line.",
      "Remove the 'Generated with [Claude Code]' footer before committing.",
    ].join("\n");

    expect(findAiAttribution(message)).toEqual([]);
  });

  it("finds attribution lines with Windows line endings", () => {
    const message = "feat: a thing\r\n\r\nCo-authored-by: Claude <x@example.com>\r\nDone.\r\n";

    expect(findAiAttribution(message)).toEqual(["Co-authored-by: Claude <x@example.com>"]);
  });

  it("returns nothing for an empty message", () => {
    expect(findAiAttribution("")).toEqual([]);
  });
});
