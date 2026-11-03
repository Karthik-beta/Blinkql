// Renders the landing page's data-driven parts to HTML at build time (see ./vite-plugin.ts), so
// the page ships as static HTML: it works without JavaScript and makes no requests for content.
import { escapeHtml, highlightSql } from "../site/html.ts";
import {
  type SampleColumn,
  type SampleRow,
  sampleColumns,
  sampleQuery,
  sampleRows,
} from "./sample.ts";

/** The hero's query in the editor, with line numbers the way the editor draws them. */
export function renderSql(lines: readonly string[] = sampleQuery.sql): string {
  return lines
    .map(
      (line, i) =>
        `<span class="sql-line"><span class="sql-gutter" aria-hidden="true">${i + 1}</span>${highlightSql(line)}</span>`,
    )
    .join(""); // each line is a block; a newline between them would add a blank line in the <pre>
}

function columnClass(column: SampleColumn): string {
  const classes = column.type === "DOUBLE" ? ["num"] : [];
  if (column.showFrom) classes.push(`show-from-${column.showFrom}`);
  return classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
}

function formatCell(value: string | number | null): string {
  if (value === null) return '<span class="null">NULL</span>';
  return escapeHtml(typeof value === "number" ? value.toFixed(3) : value);
}

/**
 * The hero's results grid: a real table, so screen readers can read the rows. The build renders
 * the static result; a live run renders its own rows in the browser.
 */
export function renderGrid(
  rows: readonly SampleRow[] = sampleRows,
  rowCount: number = sampleQuery.rowCount,
): string {
  const head = sampleColumns
    .map(
      (column) =>
        `<th scope="col"${columnClass(column)}><span class="col-name">${escapeHtml(column.name)}</span><span class="col-type">${column.type}</span></th>`,
    )
    .join("");
  const body = rows
    .map(
      (row, i) =>
        `<tr><th scope="row" class="row-number">${i + 1}</th>${row
          .map((value, c) => {
            const column = sampleColumns[c];
            return `<td${column ? columnClass(column) : ""}>${formatCell(value)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const caption = `The first ${rows.length} of ${rowCount} rows`;
  return `<table class="grid"><caption class="sr-only">${caption}</caption><thead><tr><th scope="col" class="row-number"><span class="sr-only">Row</span></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** The version the page shows, major.minor: "1.0" for 1.0.3, so a patch release reads the same. */
export function shortVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.\d+/.exec(version);
  if (!match) throw new Error(`Not a semantic version: ${version}`);
  return `${match[1]}.${match[2]}`;
}
