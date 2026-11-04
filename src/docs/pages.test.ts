// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { docsPages, docsPath, docsSections } from "./pages.ts";
import { screenshots } from "./render.ts";

const SITE = "https://blinkql.karthik.nz";
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("docs registry", () => {
  it("gives every page a unique slug, a title and a description in a known section", () => {
    expect(new Set(docsPages.map((page) => page.slug)).size).toBe(docsPages.length);
    for (const page of docsPages) {
      expect(page.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(page.title).not.toBe("");
      expect(page.description).toMatch(/^[A-Z].*\.$/);
      expect(docsSections).toContain(page.section);
    }
  });

  it("keeps each section's pages together, in section order", () => {
    const order = docsPages.map((page) => docsSections.indexOf(page.section));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("has a fragment file for every page, and a page for every fragment file", () => {
    for (const page of docsPages) {
      expect(existsSync(new URL(`docs/${page.slug}/index.html`, root)), page.slug).toBe(true);
    }
    const folders = readdirSync(new URL("docs/", root), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "screenshots")
      .map((entry) => entry.name);
    expect(folders.sort()).toEqual(docsPages.map((page) => page.slug).sort());
    expect(existsSync(new URL("docs/index.html", root))).toBe(true);
  });

  it("keeps each fragment a fragment: no document, title or lede of its own", () => {
    for (const path of ["docs/index.html", ...docsPages.map((p) => `docs/${p.slug}/index.html`)]) {
      const html = read(path);
      expect(html, path).not.toMatch(/<(!doctype|html|head|body|h1)\b/i);
    }
  });
});

describe("site files", () => {
  it("lists the docs home and every page in the sitemap, and nothing else under /docs/", () => {
    const docsUrls = [...read("public/sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map(([, url]) => url)
      .filter((url) => url?.startsWith(`${SITE}/docs/`));
    expect(docsUrls).toEqual([undefined, ...docsPages].map((page) => `${SITE}${docsPath(page)}`));
  });

  it("lists every page with its description in llms.txt", () => {
    const llms = read("public/llms.txt");
    for (const page of docsPages) {
      expect(llms).toContain(`- [${page.title}](${SITE}${docsPath(page)}): ${page.description}`);
    }
  });

  it("describes each screenshot at the size of its light and dark files", () => {
    for (const [name, shot] of Object.entries(screenshots)) {
      for (const theme of ["light", "dark"]) {
        const png = readFileSync(new URL(`docs/screenshots/${name}-${theme}.png`, root));
        // A PNG's width and height are the first fields of its IHDR chunk.
        expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${name}-${theme}`).toEqual([
          shot.width,
          shot.height,
        ]);
      }
    }
  });
});
