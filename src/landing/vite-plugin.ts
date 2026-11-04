// Fills the landing page's <!--landing:…--> placeholders, and the <!--site:…--> ones for the chrome
// it shares with the docs, at build time (and in the dev server), and preloads the headline font.
// Imported by vite.config.ts, so it runs in Node: no DOM here.
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { renderFooter, renderHeader, siteHeadTags, wordmarkSvgUrl } from "../site/chrome.ts";
import { renderGrid, renderSql, shortVersion } from "./render.ts";
import { sampleOrderCount, sampleQuery } from "./sample.ts";

/**
 * The headline's font: preloading it keeps the largest paint early. Mono (the hero's SQL) isn't
 * preloaded: it would compete with the headline for bandwidth, and its size-matched fallback in
 * landing.css keeps the swap from shifting anything.
 */
const PRELOAD_FONTS = ["atkinson-hyperlegible-next-latin-wght-normal"];

/** The released version, from package.json, which the release tooling bumps. */
function packageVersion(): string {
  const pkg: { version: string } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  return pkg.version;
}

function fragments(): Record<string, string> {
  const version = packageVersion();
  return {
    "site:head": siteHeadTags,
    "site:header": renderHeader(readFileSync(wordmarkSvgUrl, "utf8"), "outside"),
    "site:footer": renderFooter(),
    "landing:sql": renderSql(),
    "landing:grid": renderGrid(),
    "landing:version": shortVersion(version),
    "landing:software-version": version,
    "landing:row-count": String(sampleQuery.rowCount),
    "landing:elapsed-ms": String(sampleQuery.elapsedMs),
    "landing:query-tab": sampleQuery.tab,
    "landing:order-count": sampleOrderCount.toLocaleString("en-GB"),
  };
}

export function landingPage(): Plugin {
  return {
    name: "blinkql:landing-page",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        // Only the landing page (index.html at the root), not the workbench in app/.
        if (!/^\/?index\.html$/.test(ctx.path.replace(/^\//, ""))) return html;

        const values = fragments();
        const filled = html.replace(
          /<!--((?:landing|site):[\w-]+)-->/g,
          (placeholder, key: string) => {
            const value = values[key];
            if (value === undefined) throw new Error(`Unknown placeholder ${placeholder}`);
            return value;
          },
        );

        const files = Object.values(ctx.bundle ?? {});
        const fonts = PRELOAD_FONTS.flatMap((name) =>
          files.filter((file) => file.type === "asset" && file.fileName.includes(name)),
        );
        return {
          html: filled,
          tags: fonts.map((font) => ({
            tag: "link",
            attrs: {
              rel: "preload",
              href: `/${font.fileName}`,
              as: "font",
              type: "font/woff2",
              crossorigin: "",
            },
            injectTo: "head" as const,
          })),
        };
      },
    },
  };
}
