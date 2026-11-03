// Wraps a docs page's HTML fragment (docs/<slug>/index.html) into the full page, at build time and
// in the dev server (see ./vite-plugin.ts). Pure: strings in, a string out, so it runs in Node and
// in tests. The pages ship as static HTML and need no JavaScript to read or navigate.
import { type DocsPlace, renderFooter, renderHeader, siteHeadTags } from "../site/chrome.ts";
import { escapeHtml, highlightSql } from "../site/html.ts";
import { type DocsPage, docsHome, docsPages, docsPath, docsSections } from "./pages.ts";

const SITE = "https://blinkql.karthik.nz";
const SOURCE = "https://github.com/Karthik-beta/Blinkql/blob/main/";

/**
 * The README's screenshots, which a fragment places with `<!--docs:screenshot:<name>-->`. Each has
 * a light and a dark file in docs/screenshots/, and the page shows the one for its theme.
 */
export const screenshots: Readonly<Record<string, { alt: string; width: number; height: number }>> =
  {
    workbench: {
      alt: "The Blinkql workbench: three sample tables in the sidebar, a query for the reject rate by machine and day in the editor, and its 48 result rows in the grid below",
      width: 1440,
      height: 900,
    },
    chart: {
      alt: "A query's result as a bar chart of rejected parts by machine, with the chart type, X, aggregate and Y controls above it",
      width: 1440,
      height: 900,
    },
  };

function decodeEntities(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

const textOf = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, "")).trim();

/** The anchor a heading's text makes: "Open a file (CSV)" becomes "open-a-file-csv". */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "section";
}

interface Heading {
  level: 2 | 3;
  id: string;
  html: string;
}

/**
 * Gives every h2 and h3 an id from its text, keeping one the fragment set itself. A repeated text
 * gets -2, -3 and so on, so every anchor is unique on the page.
 */
function addHeadingIds(
  html: string,
  reserved: readonly string[],
): { html: string; headings: Heading[] } {
  const used = new Set(reserved);
  const headings: Heading[] = [];
  const result = html.replace(
    /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g,
    (_, level: string, attrs = "", inner: string) => {
      const own = /\bid="([^"]*)"/.exec(attrs)?.[1];
      let id = own ?? slugify(textOf(inner));
      if (!own) {
        const base = id;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      }
      used.add(id);
      headings.push({ level: level === "2" ? 2 : 3, id, html: inner });
      return own
        ? `<h${level}${attrs}>${inner}</h${level}>`
        : `<h${level} id="${id}"${attrs}>${inner}</h${level}>`;
    },
  );
  return { html: result, headings };
}

/** SQL blocks, coloured like the workbench's editor. The fragment escapes `<` and `&` as HTML. */
function highlightCode(html: string): string {
  return html.replace(
    /<pre><code class="language-sql">([\s\S]*?)<\/code><\/pre>/g,
    (_, code: string) => {
      const lines = decodeEntities(code).replace(/^\n/, "").trimEnd().split("\n");
      return `<pre><code class="language-sql">${lines.map(highlightSql).join("\n")}</code></pre>`;
    },
  );
}

function expandScreenshots(html: string): string {
  return html.replace(/<!--docs:screenshot:([\w-]+)-->/g, (placeholder, name: string) => {
    const shot = screenshots[name];
    if (!shot) throw new Error(`Unknown docs screenshot ${placeholder}`);
    // Both themes' images are in the page; CSS shows the one for the page's theme (the `.dark`
    // class, which can differ from the system's), and the hidden one, lazy, is never fetched.
    const image = (theme: string) =>
      `<img class="screenshot-${theme}" src="/docs/screenshots/${name}-${theme}.png" alt="${escapeHtml(shot.alt)}" width="${shot.width}" height="${shot.height}" loading="lazy" decoding="async" />`;
    return `<figure class="docs-screenshot">${image("light")}${image("dark")}</figure>`;
  });
}

const NUMBER = /^[+\-−]?\d[\d,.]*(\s?(%|[A-Za-z]{1,3}))?$/;
const CELL = /<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/g;
const ROW = /<tr\b[\s\S]*?<\/tr>/g;

/**
 * Right-aligns a table's number columns, header included: a column whose every body cell is a
 * number, such as 56, 1.5 GB or 45%.
 */
function alignNumbers(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table>/g, (table) => {
    const body = /<tbody\b[\s\S]*?<\/tbody>/.exec(table)?.[0] ?? "";
    const rows = [...body.matchAll(ROW)].map(([row]) =>
      [...row.matchAll(CELL)].map(([, , , inner = ""]) => textOf(inner)),
    );
    if (rows.length === 0) return table;
    const width = Math.max(...rows.map((cells) => cells.length));
    const numeric = new Set(
      Array.from({ length: width }, (_, i) => i).filter((i) =>
        rows.every((cells) => NUMBER.test(cells[i] ?? "")),
      ),
    );
    if (numeric.size === 0) return table;
    return table.replace(ROW, (row) => {
      let i = 0;
      return row.replace(/<(t[hd])\b([^>]*)>/g, (tag, name: string, attrs: string) =>
        numeric.has(i++) ? `<${name} class="num"${attrs}>` : tag,
      );
    });
  });
}

function renderNavList(current: DocsPage | undefined): string {
  return docsSections
    .map((section) => {
      const items = docsPages
        .filter((page) => page.section === section)
        .map(
          (page) =>
            `<li><a href="${docsPath(page)}"${page === current ? ' aria-current="page"' : ""}>${escapeHtml(page.title)}</a></li>`,
        )
        .join("");
      return `<p class="docs-nav-section">${section}</p><ul>${items}</ul>`;
    })
    .join("");
}

/** The docs home's list of every page, under its section, with its description. */
function renderIndex(): string {
  return docsSections
    .map((section) => {
      const items = docsPages
        .filter((page) => page.section === section)
        .map(
          (page) =>
            `<li><a href="${docsPath(page)}">${escapeHtml(page.title)}</a><p>${escapeHtml(page.description)}</p></li>`,
        )
        .join("");
      return `<h2>${section}</h2><ul class="docs-index">${items}</ul>`;
    })
    .join("");
}

function renderPager(page: DocsPage): string {
  const i = docsPages.indexOf(page);
  const previous = docsPages[i - 1];
  const next = docsPages[i + 1];
  const links = [
    previous &&
      `<a class="docs-pager-previous" rel="prev" href="${docsPath(previous)}">Previous: ${escapeHtml(previous.title)}</a>`,
    next &&
      `<a class="docs-pager-next" rel="next" href="${docsPath(next)}">Next: ${escapeHtml(next.title)}</a>`,
  ].filter(Boolean);
  return `<nav class="docs-pager" aria-label="Previous and next pages">${links.join("")}</nav>`;
}

const TOC_TITLE_ID = "docs-toc-title";

function renderToc(headings: readonly Heading[]): string {
  const sections = headings.filter((heading) => heading.level === 2);
  // A single section needs no list of sections.
  if (sections.length < 2) return "";
  const items = sections
    .map((heading) => `<li><a href="#${heading.id}">${heading.html}</a></li>`)
    .join("");
  return `<nav class="docs-toc" aria-labelledby="${TOC_TITLE_ID}"><p class="docs-toc-title" id="${TOC_TITLE_ID}">On this page</p><ul>${items}</ul></nav>`;
}

export interface DocsPageInput {
  /** The page from the registry, or undefined for the docs home. */
  page: DocsPage | undefined;
  /** The page's body: the file's HTML fragment. */
  fragment: string;
  /** The brand wordmark SVG, which the header inlines. */
  wordmarkSvg: string;
}

export function renderDocsPage({ page, fragment, wordmarkSvg }: DocsPageInput): string {
  const { title, description } = page ?? docsHome;
  const documentTitle = page ? `${page.title} | Blinkql docs` : "Docs | Blinkql";
  const path = docsPath(page);
  const place: DocsPlace = page ? "page" : "home";
  const source = page ? `docs/${page.slug}/index.html` : "docs/index.html";

  const content = alignNumbers(highlightCode(expandScreenshots(fragment)));
  const body = addHeadingIds(page ? content : content + renderIndex(), ["main", TOC_TITLE_ID]);
  const nav = renderNavList(page);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(documentTitle)}</title>
    <script src="/theme-init.js"></script>
    <link rel="canonical" href="${SITE}${path}" />
    ${siteHeadTags}
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Blinkql" />
    <meta property="og:title" content="${escapeHtml(documentTitle)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${SITE}${path}" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="The Blinkql wordmark and the headline Queries in the blink of an eye, beside a SQL query that returned 10 rows in 38 ms" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="stylesheet" href="/src/docs/docs.css" />
    <script type="module" src="/src/site/follow-system-theme.ts"></script>
  </head>
  <body class="docs">
    <a class="skip-link" href="#main">Skip to content</a>
    ${renderHeader(wordmarkSvg, place)}
    <div class="docs-layout">
      <div class="docs-sidebar"><nav aria-label="Docs">${nav}</nav></div>
      <div class="docs-column">
        <details class="docs-disclosure">
          <summary>Docs pages</summary>
          <nav aria-label="Docs">${nav}</nav>
        </details>
        <main id="main">
          <h1 class="title">${escapeHtml(title)}</h1>
          <p class="lede">${escapeHtml(description)}</p>
          <div class="docs-prose">${body.html}</div>
          ${page ? renderPager(page) : ""}
          <p class="docs-improve"><a href="${SOURCE}${source}">Improve this page on GitHub</a></p>
        </main>
      </div>
      ${renderToc(body.headings)}
    </div>
    ${renderFooter()}
  </body>
</html>
`;
}
