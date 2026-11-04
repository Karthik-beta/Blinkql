import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shortcutGroups } from "@/features/commands/ShortcutsDialog";
import { templates } from "@/features/templates/registry";

/** A docs page's text as a reader sees it, without tags. */
function pageText(slug: string): string {
  // Relative to the repository root, where Vitest runs.
  const html = readFileSync(`docs/${slug}/index.html`, "utf8");
  return html
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ");
}

describe("docs pages that list what the workbench has", () => {
  it("lists every keyboard shortcut the workbench's shortcut reference shows", () => {
    const text = pageText("keyboard-shortcuts");
    for (const { title, shortcuts } of shortcutGroups) {
      for (const [action] of shortcuts) expect(text, title).toContain(action);
    }
  });

  it("lists every analysis template by its title", () => {
    const text = pageText("templates");
    for (const template of templates) expect(text).toContain(template.title);
  });
});
