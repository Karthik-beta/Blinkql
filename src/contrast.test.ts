// @vitest-environment node
// Turns the colour rules in the Design Tokens wiki page (section 8) into a regression check:
// every text, control and chart colour must keep its WCAG contrast ratio in both themes.
import { readFileSync } from "node:fs";
import { wcagContrast } from "culori";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");

/**
 * Custom properties declared in the top-level rule for `selector`, e.g. ":root" or ".dark", which
 * may list other selectors after it.
 */
function tokens(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = css.match(new RegExp(`^${escaped}(?:,[^{]*)?\\s*\\{([^}]*)\\}`, "m"))?.[1];
  if (body === undefined) throw new Error(`No "${selector}" block in styles/tokens.css`);
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value?.trim()]),
  );
}

const themes = { light: tokens(":root"), dark: tokens(".dark") };

// [foreground, background, minimum ratio]: 4.5:1 for text, 3:1 for field edges, rings and marks
const pairs: [string, string, number][] = [
  ["foreground", "background", 4.5],
  ["foreground", "chrome", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "chrome", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["primary", "background", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["destructive", "background", 4.5],
  ["warning-foreground", "warning", 4.5],
  ["warning-text", "background", 4.5],
  ["success-foreground", "success", 4.5],
  ["foreground", "selection", 4.5],
  ["foreground", "popover", 4.5],
  ["syntax-keyword", "background", 4.5],
  ["syntax-string", "background", 4.5],
  ["syntax-number", "background", 4.5],
  ["syntax-function", "background", 4.5],
  ["syntax-comment", "background", 4.5],
  ["input", "background", 3],
  ["input", "chrome", 3],
  ["ring", "background", 3],
  ["ring", "chrome", 3],
  ["data-ink", "background", 3],
  ["data-reference", "background", 4.5],
  ...[1, 2, 3, 4, 5, 6].map((i): [string, string, number] => [`chart-${i}`, "background", 3]),
];

describe.each(Object.entries(themes))("%s theme", (_, theme) => {
  it.each(pairs)("%s on %s ≥ %d:1", (fg, bg, min) => {
    const foreground = theme[fg];
    const background = theme[bg];
    if (foreground === undefined || background === undefined) {
      throw new Error(`Missing token --${foreground === undefined ? fg : bg}`);
    }
    expect(wcagContrast(foreground, background)).toBeGreaterThanOrEqual(min);
  });
});
