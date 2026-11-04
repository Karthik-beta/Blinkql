// The docs pages, in reading order: the one source of their order, titles and descriptions (each
// page's meta description and lede). Each page's body is docs/<slug>/index.html, an HTML fragment
// that the build wraps into a full page (./vite-plugin.ts).

export type DocsSection = "Guides" | "Reference";

export interface DocsPage {
  slug: string;
  title: string;
  description: string;
  section: DocsSection;
}

export const docsSections: readonly DocsSection[] = ["Guides", "Reference"];

/** The docs home at /docs/ (docs/index.html), which lists every page below. */
export const docsHome = {
  title: "Docs",
  description:
    "Learn to open your files in Blinkql, query them in SQL, and share what you find, all in your browser.",
};

export const docsPages: readonly DocsPage[] = [
  {
    section: "Guides",
    slug: "get-started",
    title: "Get started",
    description: "Open the workbench, load sample data or your own file, and run your first query.",
  },
  {
    section: "Guides",
    slug: "open-files",
    title: "Open files",
    description:
      "Open CSV, TSV, Excel, Parquet and JSON files from your computer or a web address, and keep them between visits.",
  },
  {
    section: "Guides",
    slug: "write-queries",
    title: "Write queries",
    description:
      "Write SQL with autocomplete, run all or part of a query, cancel it, fix errors and find past queries.",
  },
  {
    section: "Guides",
    slug: "explore-results",
    title: "Explore results",
    description:
      "Scroll through results, profile a table's columns and chart what a query returns.",
  },
  {
    section: "Guides",
    slug: "templates",
    title: "Analysis templates",
    description:
      "Run ready-made analyses such as two-file reconciliation, on-time delivery and OEE on sample data or your own files.",
  },
  {
    section: "Guides",
    slug: "share-and-export",
    title: "Share and export",
    description:
      "Export results and charts, save an analysis as an HTML report, and share a query as a link.",
  },
  {
    section: "Reference",
    slug: "keyboard-shortcuts",
    title: "Keyboard shortcuts",
    description: "Every keyboard shortcut in the workbench, grouped by where it works.",
  },
  {
    section: "Reference",
    slug: "privacy-and-storage",
    title: "Privacy and storage",
    description:
      "What stays on your computer, what the browser keeps between visits, and how to remove it.",
  },
  {
    section: "Reference",
    slug: "browser-support",
    title: "Browser support and limits",
    description:
      "Which browsers Blinkql supports, how large a file it handles, and what to do when something doesn't work.",
  },
];

/** The page's address on the site, such as /docs/get-started/. */
export function docsPath(page: DocsPage | undefined): string {
  return page ? `/docs/${page.slug}/` : "/docs/";
}
