// An analysis as one HTML file to hand to someone: the SQL, the chart and the first rows of the
// result. It loads nothing from elsewhere (its Content Security Policy allows inline styles and
// data: images only), so it reads the same offline, in any browser.
import type { ChartPicture } from "@/features/charts/chart-settings";
import { formatRows } from "./format";

/** The most rows a report shows; the rest are only counted. */
export const REPORT_ROWS = 1_000;

/** What a report shows, already formatted as text. */
export type Report = {
  title: string;
  createdAt: Date;
  sql: string;
  /** Numeric columns line up on the right, as in the workbench. */
  columns: readonly { name: string; numeric: boolean }[];
  /** The result's first rows as the workbench shows them, null for SQL NULL. */
  rows: readonly (readonly (string | null)[])[];
  /** How many rows the whole result has. */
  rowCount: number;
  /** The chart on screen when the report was made, if one was. */
  chart: ChartPicture | null;
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** `text` safe to put in HTML, as content or as a quoted attribute value. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

// The workbench's colours (src/styles/tokens.css). Printing always uses the light ones.
const STYLE = `
:root {
  color-scheme: light dark;
  --background: oklch(0.99 0.002 150);
  --foreground: oklch(0.235 0.012 150);
  --muted-foreground: oklch(0.475 0.012 150);
  --border: oklch(0.885 0.007 150);
  --chrome: oklch(0.958 0.005 150);
  --primary: oklch(0.5 0.141 250);
}
@media screen and (prefers-color-scheme: dark) {
  :root {
    --background: oklch(0.245 0.006 150);
    --foreground: oklch(0.935 0.006 150);
    --muted-foreground: oklch(0.735 0.01 150);
    --border: oklch(0.345 0.008 150);
    --chrome: oklch(0.218 0.006 150);
    --primary: oklch(0.735 0.125 250);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  max-width: 72rem;
  padding: 1.5rem 1rem;
  background: var(--background);
  color: var(--foreground);
  font: 0.875rem/1.5 system-ui, sans-serif;
}
h1 { margin: 0; font-size: 1.25rem; }
h2 { margin: 1.5rem 0 0.5rem; font-size: 1rem; }
header p, footer, caption, .null { color: var(--muted-foreground); }
a { color: var(--primary); }
pre, table { font: 0.75rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
pre {
  margin: 0;
  padding: 0.75rem;
  overflow-x: auto;
  white-space: pre-wrap;
  background: var(--chrome);
  border: 1px solid var(--border);
  border-radius: 0.375rem;
}
figure { margin: 0; }
img { display: block; max-width: 100%; height: auto; border: 1px solid var(--border); }
img.dark { display: none; }
@media screen and (prefers-color-scheme: dark) {
  img.light { display: none; }
  img.dark { display: block; }
}
.table { overflow-x: auto; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
caption { padding-bottom: 0.25rem; text-align: left; font-family: system-ui, sans-serif; }
th, td {
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--border);
  text-align: left;
  white-space: pre;
}
th { background: var(--chrome); font-weight: 600; }
.number { text-align: right; }
footer { margin-top: 1.5rem; }
@media print {
  body { max-width: none; padding: 0; }
  .table { overflow: visible; }
  thead { display: table-header-group; }
  tr, img { break-inside: avoid; }
}
`;

const count = new Intl.NumberFormat();
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" });

/** "Result: 40 rows", or "Result: first 1,000 of 2,500 rows" when only some are shown. */
function caption(shown: number, rowCount: number): string {
  return shown < rowCount
    ? `Result: first ${count.format(shown)} of ${formatRows(rowCount)}`
    : `Result: ${formatRows(rowCount)}`;
}

function tableHtml({ columns, rows, rowCount }: Report): string {
  const shown = rows.slice(0, REPORT_ROWS);
  const head = columns.map(
    ({ name, numeric }) =>
      `<th scope="col"${numeric ? ' class="number"' : ""}>${escapeHtml(name)}</th>`,
  );
  const body = shown.map((row) => {
    const cells = row.map((cell, i) => {
      const classes = [columns[i]?.numeric && "number", cell === null && "null"].filter(Boolean);
      const attribute = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
      return `<td${attribute}>${cell === null ? "NULL" : escapeHtml(cell)}</td>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  });
  // A wide table scrolls on its own, so the region takes focus for the keyboard to scroll it.
  return `<div class="table" role="region" aria-labelledby="result" tabindex="0">
<table>
<caption>${escapeHtml(caption(shown.length, rowCount))}</caption>
<thead><tr>${head.join("")}</tr></thead>
<tbody>
${body.join("\n")}
</tbody>
</table>
</div>`;
}

/** The report as a complete HTML document. */
export function reportHtml(report: Report): string {
  const { title, createdAt, sql, rowCount, chart } = report;
  // The chart in both themes; the style shows the one that matches the page's colours.
  const chartSection = chart
    ? `<h2>Chart</h2>
<figure>
<img class="light" src="${escapeHtml(chart.light)}" alt="${escapeHtml(chart.description)}">
<img class="dark" src="${escapeHtml(chart.dark)}" alt="${escapeHtml(chart.description)}">
</figure>
`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
<p>Made on <time datetime="${createdAt.toISOString()}">${escapeHtml(longDate.format(createdAt))}</time> · ${escapeHtml(formatRows(rowCount))}</p>
</header>
<main>
<h2>Query</h2>
<pre><code>${escapeHtml(sql)}</code></pre>
${chartSection}<h2 id="result">Result</h2>
${tableHtml(report)}
</main>
<footer>Made with <a href="https://blinkql.karthik.nz">Blinkql</a></footer>
</body>
</html>
`;
}
