// Turns each docs fragment (docs/index.html and docs/<slug>/index.html) into its full page, at build
// time and in the dev server. Imported by vite.config.ts, so it runs in Node: no DOM here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { wordmarkSvgUrl } from "../site/chrome.ts";
import { docsPages } from "./pages.ts";
import { renderDocsPage } from "./render.ts";

const DOCS_HTML = /^docs\/(?:([\w-]+)\/)?index\.html$/;

/** Rollup inputs for the docs home and every page in the registry, for vite.config.ts. */
export function docsInputs(root: URL): Record<string, string> {
  const file = (path: string) => fileURLToPath(new URL(path, root));
  return {
    docs: file("docs/index.html"),
    ...Object.fromEntries(
      docsPages.map((page) => [`docs/${page.slug}`, file(`docs/${page.slug}/index.html`)]),
    ),
  };
}

export function docsSection(): Plugin {
  return {
    name: "blinkql:docs",
    transformIndexHtml: {
      // Before Vite reads the page, so it bundles the script, styles and images the wrapper adds.
      order: "pre",
      handler(html, ctx) {
        const match = DOCS_HTML.exec(ctx.path.replace(/^\//, ""));
        if (!match) return html;
        const slug = match[1];
        const page = slug === undefined ? undefined : docsPages.find((p) => p.slug === slug);
        if (slug !== undefined && !page) {
          throw new Error(`docs/${slug}/index.html isn't in the docs registry (src/docs/pages.ts)`);
        }
        return renderDocsPage({
          page,
          fragment: html,
          wordmarkSvg: readFileSync(wordmarkSvgUrl, "utf8"),
        });
      },
    },
  };
}
