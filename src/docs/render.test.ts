// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wordmarkSvgUrl } from "../site/chrome.ts";
import { escapeHtml } from "../site/html.ts";
import { type DocsPage, docsPages } from "./pages.ts";
import { renderDocsPage, slugify } from "./render.ts";

const wordmarkSvg = readFileSync(wordmarkSvgUrl, "utf8");
const render = (page: DocsPage | undefined, fragment = "<p>Text.</p>") =>
  renderDocsPage({ page, fragment, wordmarkSvg });
const pageAt = (i: number) => {
  const page = docsPages.at(i);
  if (!page) throw new Error(`No docs page at ${i}`);
  return page;
};
const first = pageAt(0);
const last = pageAt(-1);
const between = pageAt(1);

/** The part of the page between two markers, such as one landmark. */
function part(html: string, start: string, end: string): string {
  const from = html.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  return html.slice(from, html.indexOf(end, from));
}
const sidebar = (html: string) => part(html, '<div class="docs-sidebar">', "</div>");
const main = (html: string) => part(html, '<main id="main">', "</main>");

describe("docs page head", () => {
  it("titles, describes and points search engines at the page", () => {
    const html = render(first);
    expect(html).toContain(`<title>${first.title} | Blinkql docs</title>`);
    expect(html).toContain(`<meta name="description" content="${first.description}" />`);
    const url = `https://blinkql.karthik.nz/docs/${first.slug}/`;
    expect(html).toContain(`<link rel="canonical" href="${url}" />`);
    expect(html).toContain(`<meta property="og:url" content="${url}" />`);
    expect(html).toContain(`<meta property="og:title" content="${first.title} | Blinkql docs" />`);
    expect(html).toContain(
      '<meta property="og:image" content="https://blinkql.karthik.nz/og-image.png" />',
    );
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
    expect(html).toContain('<script src="/theme-init.js"></script>');
  });

  it("titles the docs home Docs | Blinkql at /docs/", () => {
    const html = render(undefined);
    expect(html).toContain("<title>Docs | Blinkql</title>");
    expect(html).toContain('<link rel="canonical" href="https://blinkql.karthik.nz/docs/" />');
  });
});

describe("docs page body", () => {
  it("opens with the title and the registry description as the lede", () => {
    expect(main(render(between))).toMatch(
      new RegExp(
        `^<main id="main">\\s*<h1 class="title">${between.title}</h1>\\s*<p class="lede">${between.description}</p>`,
      ),
    );
  });

  it("lists every page in the sidebar under its section, marking only the current one", () => {
    const nav = sidebar(render(between));
    expect(
      [...nav.matchAll(/<p class="docs-nav-section">([^<]+)<\/p>/g)].map(([, s]) => s),
    ).toEqual(["Guides", "Reference"]);
    const links = [...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)];
    expect(links.map(([, href]) => href)).toEqual(docsPages.map((p) => `/docs/${p.slug}/`));
    expect(
      links.filter(([, , attrs]) => attrs?.includes('aria-current="page"')).map(([, , , t]) => t),
    ).toEqual([between.title]);
    const reference = nav.slice(nav.indexOf(">Reference<"));
    for (const page of docsPages) {
      expect(reference.includes(`>${page.title}<`), page.slug).toBe(page.section === "Reference");
    }
  });

  it("offers the same list in a disclosure for narrow screens", () => {
    const html = render(between);
    const disclosure = part(html, '<details class="docs-disclosure">', "</details>");
    expect(disclosure).toContain("<summary>Docs pages</summary>");
    expect(disclosure).toContain(part(sidebar(html), "<nav", "</nav>"));
  });

  it("marks Docs as current in the header: the page itself on the home, the section elsewhere", () => {
    expect(render(undefined)).toContain('<a href="/docs/" aria-current="page">Docs</a>');
    expect(render(between)).toContain('<a href="/docs/" aria-current="true">Docs</a>');
  });

  it("links to the previous and next pages in registry order, with nothing past either end", () => {
    const pager = (html: string) =>
      [...part(html, '<nav class="docs-pager"', "</nav>").matchAll(/href="([^"]+)">([^<]+)</g)].map(
        ([, href, text]) => `${text} ${href}`,
      );
    expect(pager(render(between))).toEqual([
      `Previous: ${first.title} /docs/${first.slug}/`,
      `Next: ${pageAt(2).title} /docs/${pageAt(2).slug}/`,
    ]);
    expect(pager(render(first))).toEqual([`Next: ${between.title} /docs/${between.slug}/`]);
    expect(pager(render(last))).toEqual([
      `Previous: ${pageAt(-2).title} /docs/${pageAt(-2).slug}/`,
    ]);
    expect(render(undefined)).not.toContain("docs-pager");
  });

  it("links to the page's own file on main for corrections", () => {
    expect(render(between)).toContain(
      `<a href="https://github.com/Karthik-beta/Blinkql/blob/main/docs/${between.slug}/index.html">Improve this page on GitHub</a>`,
    );
    expect(render(undefined)).toContain("/blob/main/docs/index.html");
  });

  it("escapes registry text everywhere it appears", () => {
    const page: DocsPage = {
      slug: "x",
      title: `Tom & "Jerry" <b>`,
      description: "A <script> & co.",
      section: "Guides",
    };
    const html = render(page);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script> &");
    expect(html).toContain("<title>Tom &amp; &quot;Jerry&quot; &lt;b&gt; | Blinkql docs</title>");
    expect(html).toContain('content="A &lt;script&gt; &amp; co."');
  });
});

describe("docs home", () => {
  it("lists every page under its section, with its description", () => {
    const html = main(render(undefined, "<p>Intro.</p>"));
    expect(html).toContain("<p>Intro.</p>");
    expect(html).toContain('<h2 id="guides">Guides</h2>');
    expect(html).toContain('<h2 id="reference">Reference</h2>');
    for (const page of docsPages) {
      expect(html).toContain(
        `<li><a href="/docs/${page.slug}/">${page.title}</a><p>${escapeHtml(page.description)}</p></li>`,
      );
    }
    expect(html.indexOf(">Reference<")).toBeGreaterThan(html.indexOf(`>${pageAt(5).title}<`));
  });
});

describe("fragment", () => {
  it("gives each heading an id from its text, unique on the page", () => {
    const html = main(
      render(
        first,
        '<h2>Open a file</h2><h3>From <code>CSV</code> &amp; TSV</h3><h2>Open a file</h2><h3 id="kept">Kept</h3><h2>Main</h2>',
      ),
    );
    expect(html).toContain('<h2 id="open-a-file">Open a file</h2>');
    expect(html).toContain('<h3 id="from-csv-tsv">From <code>CSV</code> &amp; TSV</h3>');
    expect(html).toContain('<h2 id="open-a-file-2">Open a file</h2>');
    expect(html).toContain('<h3 id="kept">Kept</h3>');
    // "main" is the skip link's target.
    expect(html).toContain('<h2 id="main-2">Main</h2>');
  });

  it("makes anchors of plain words", () => {
    expect(slugify("Café: what’s new?")).toBe("cafe-what-s-new");
    expect(slugify("!!!")).toBe("section");
  });

  it("lists the h2s on this page when there are two or more", () => {
    const html = render(first, "<h2>One</h2><h3>Sub</h3><h2>Two</h2>");
    const toc = part(html, '<nav class="docs-toc"', "</nav>");
    expect(toc).toContain("On this page");
    expect([...toc.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id)).toEqual(["one", "two"]);
    expect(render(first, "<h2>Only</h2>")).not.toContain("docs-toc");
  });

  it("colours SQL like the editor, from the fragment's escaped text", () => {
    const html = render(
      first,
      `<pre><code class="language-sql">\nSELECT count(*) FROM t\nWHERE a &lt; 'x &amp; y';\n</code></pre>`,
    );
    expect(html).toContain(
      '<pre><code class="language-sql"><span class="sql-keyword">SELECT</span> <span class="sql-function">count</span>(*) <span class="sql-keyword">FROM</span> t\n<span class="sql-keyword">WHERE</span> a &lt; <span class="sql-string">&#39;x &amp; y&#39;</span>;</code></pre>',
    );
  });

  it("leaves other code alone", () => {
    expect(render(first, "<p><code>SELECT</code></p>")).toContain("<p><code>SELECT</code></p>");
  });

  it("expands a screenshot into its light and dark images, with the README's alt text", () => {
    const html = main(render(first, "<!--docs:screenshot:workbench-->"));
    expect(html).toContain('<figure class="docs-screenshot">');
    for (const theme of ["light", "dark"]) {
      expect(html).toMatch(
        new RegExp(
          `<img class="screenshot-${theme}" src="/docs/screenshots/workbench-${theme}.png" alt="The Blinkql workbench: [^"]+" width="1440" height="900" loading="lazy"`,
        ),
      );
    }
    expect(() => render(first, "<!--docs:screenshot:nope-->")).toThrow("nope");
  });

  it("right-aligns a table's number columns, header included", () => {
    const html = render(
      first,
      '<table><thead><tr><th scope="col">Format</th><th scope="col">Size</th></tr></thead><tbody><tr><td>CSV</td><td>1.5 GB</td></tr><tr><td>Parquet</td><td>45%</td></tr></tbody></table>',
    );
    expect(html).toContain('<th scope="col">Format</th><th class="num" scope="col">Size</th>');
    expect(html).toContain('<td>CSV</td><td class="num">1.5 GB</td>');
    expect(html).toContain('<td>Parquet</td><td class="num">45%</td>');
  });
});
