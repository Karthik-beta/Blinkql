// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inlineWordmark,
  renderFooter,
  renderHeader,
  siteHeadTags,
  wordmarkSvgUrl,
} from "./chrome.ts";

const svg = readFileSync(wordmarkSvgUrl, "utf8");

describe("wordmark", () => {
  const html = inlineWordmark(svg);

  it("follows the text colour and hides from screen readers (the link has the name)", () => {
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toContain("#1A201B");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });

  it("gives the lamp a halo for the done flash", () => {
    expect(html).toContain('class="wordmark-halo"');
    expect(html).toContain('class="wordmark-lamp"');
  });
});

describe("header", () => {
  const links = (html: string) =>
    [...html.matchAll(/<a href="([^"]+)"([^>]*)>([^<]*)<\/a>/g)].map(([, href, attrs, text]) => ({
      href,
      text,
      current: /aria-current="([^"]+)"/.exec(attrs ?? "")?.[1],
    }));

  it("links to the docs, GitHub and the workbench, with no filled button", () => {
    const html = renderHeader(svg, "outside");
    expect(links(html)).toEqual([
      { href: "/docs/", text: "Docs", current: undefined },
      { href: "https://github.com/Karthik-beta/Blinkql", text: "GitHub", current: undefined },
      { href: "/app/", text: "Open the workbench", current: undefined },
    ]);
    expect(html).not.toContain("button");
    expect(html).toContain('<span class="sr-only">Blinkql home</span>');
  });

  it("marks Docs as the current page on the docs home, and as current inside the docs", () => {
    expect(links(renderHeader(svg, "home"))[0]?.current).toBe("page");
    expect(links(renderHeader(svg, "page"))[0]?.current).toBe("true");
  });
});

describe("footer", () => {
  const html = renderFooter();

  it("links to the workbench, docs, GitHub and wiki", () => {
    const names = [...html.matchAll(/<li><a href="[^"]+">([^<]+)<\/a><\/li>/g)].map(([, n]) => n);
    expect(names).toEqual(["Workbench", "Docs", "GitHub", "Wiki"]);
  });

  it("states the licence, the author and that the page has no analytics", () => {
    expect(html).toContain("MIT licence");
    expect(html).toContain('<a href="https://karthik.nz/">Karthik Parameshwara</a>');
    expect(html).toContain("This page uses no analytics and makes no third-party requests.");
  });
});

describe("head tags", () => {
  it("match the brand kit's icons, manifest and theme colours", () => {
    const brand = readFileSync(new URL("../../brand/web/head.html", import.meta.url), "utf8");
    const tags = (html: string) =>
      [
        ...html.matchAll(
          /<(link rel="(?:icon|apple-touch-icon|manifest)"|meta name="theme-color")[^>]*>/g,
        ),
      ].map(([tag]) => tag.replace(/\s*\/?>$/, ""));
    expect(tags(siteHeadTags)).toEqual(tags(brand));
    expect(tags(siteHeadTags)).toHaveLength(6);
  });
});
