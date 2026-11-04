// Preloads the headline font on the site's static pages, the landing page and the docs, at build
// time. Imported by vite.config.ts, so it runs in Node: no DOM here.
import type { Plugin } from "vite";

/**
 * The font the headings and running text use. Preloading it keeps the largest paint early, and
 * the text no longer reflows when it arrives. Mono (SQL) isn't preloaded: it would compete for
 * bandwidth, and its size-matched fallback in site.css keeps the swap from shifting anything.
 */
const PRELOAD_FONTS = ["atkinson-hyperlegible-next-latin-wght-normal"];

/** The landing page (index.html at the root) and every docs page, not the workbench in app/. */
const SITE_PAGE = /^(?:index\.html|docs\/(?:[\w-]+\/)?index\.html)$/;

export function siteFonts(): Plugin {
  return {
    name: "blinkql:site-fonts",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!SITE_PAGE.test(ctx.path.replace(/^\//, ""))) return html;

        const files = Object.values(ctx.bundle ?? {});
        const fonts = PRELOAD_FONTS.flatMap((name) =>
          files.filter((file) => file.type === "asset" && file.fileName.includes(name)),
        );
        return fonts.map((font) => ({
          tag: "link",
          attrs: {
            rel: "preload",
            href: `/${font.fileName}`,
            as: "font",
            type: "font/woff2",
            crossorigin: "",
          },
          injectTo: "head" as const,
        }));
      },
    },
  };
}
