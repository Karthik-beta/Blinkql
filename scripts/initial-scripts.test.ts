import { describe, expect, it } from "vitest";
import { initialScripts } from "./initial-scripts.ts";

describe("initialScripts", () => {
  it("lists script sources and module preloads in document order", () => {
    const html = `
      <script src="/theme-init.js"></script>
      <script type="module" crossorigin src="/assets/app-W9N673RP.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/engine-R7SHcZPJ.js">
      <link rel="stylesheet" crossorigin href="/assets/app-ChmDNiQ9.css">`;

    expect(initialScripts(html)).toEqual([
      "/theme-init.js",
      "/assets/app-W9N673RP.js",
      "/assets/engine-R7SHcZPJ.js",
    ]);
  });

  it("ignores inline scripts, other links and other origins", () => {
    const html = `
      <script type="application/ld+json">{"@type": "WebSite"}</script>
      <link rel="preload" href="/assets/font.woff2" as="font">
      <link rel="icon" href="/favicon.svg">
      <script src="https://example.com/a.js"></script>
      <script src="//example.com/b.js"></script>`;

    expect(initialScripts(html)).toEqual([]);
  });

  it("accepts single-quoted and unquoted attributes, and lists a file once", () => {
    const html = `
      <link rel='modulepreload' href='/assets/a.js'>
      <link rel=modulepreload href=/assets/b.js>
      <script type="module" src="/assets/a.js"></script>`;

    expect(initialScripts(html)).toEqual(["/assets/a.js", "/assets/b.js"]);
  });
});
