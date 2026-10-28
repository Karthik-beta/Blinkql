// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SITE = "https://blinkql.karthik.nz";
const read = (path: string) => readFileSync(path, "utf8");

describe("site address", () => {
  it("names blinkql.karthik.nz in the landing page head", () => {
    const html = read("index.html");
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE}/" />`);
    expect(html).toContain(`<meta property="og:image" content="${SITE}/og-image.png" />`);
    expect(html).toContain(`"url": "${SITE}/"`);
  });

  it("names blinkql.karthik.nz in the workbench link previews", () => {
    const html = read("app/index.html");
    expect(html).toContain(`<meta property="og:url" content="${SITE}/" />`);
    expect(html).toContain(`<meta property="og:image" content="${SITE}/og-image.png" />`);
  });

  it("points crawlers at the sitemap on blinkql.karthik.nz", () => {
    expect(read("public/robots.txt")).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(read("public/sitemap.xml")).toContain(`<loc>${SITE}/</loc>`);
  });

  it.each([
    "index.html",
    "app/index.html",
    "public/robots.txt",
    "public/sitemap.xml",
    "public/llms.txt",
  ])("%s no longer mentions the old vercel.app address", (path) => {
    expect(read(path)).not.toContain("blinkql.vercel.app");
  });
});
