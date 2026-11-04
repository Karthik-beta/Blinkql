// Fills the landing page's <!--landing:…--> placeholders, and the <!--site:…--> ones for the chrome
// it shares with the docs, at build time (and in the dev server). Imported by vite.config.ts, so it
// runs in Node: no DOM here.
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { renderFooter, renderHeader, siteHeadTags, wordmarkSvgUrl } from "../site/chrome.ts";
import { milestones } from "./milestones.ts";
import { renderGrid, renderMilestones, renderSql } from "./render.ts";
import { sampleQuery } from "./sample.ts";

function fragments(): Record<string, string> {
  return {
    "site:head": siteHeadTags,
    "site:header": renderHeader(readFileSync(wordmarkSvgUrl, "utf8"), "outside"),
    "site:footer": renderFooter(),
    "landing:sql": renderSql(),
    "landing:grid": renderGrid(),
    "landing:milestones": renderMilestones(milestones),
    "landing:row-count": String(sampleQuery.rowCount),
    "landing:elapsed-ms": String(sampleQuery.elapsedMs),
    "landing:query-tab": sampleQuery.tab,
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
        return html.replace(/<!--((?:landing|site):[\w-]+)-->/g, (placeholder, key: string) => {
          const value = values[key];
          if (value === undefined) throw new Error(`Unknown placeholder ${placeholder}`);
          return value;
        });
      },
    },
  };
}
