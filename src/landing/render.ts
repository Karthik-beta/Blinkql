// Renders the landing page's data-driven parts to HTML at build time (see ./vite-plugin.ts), so
// the page ships as static HTML: it works without JavaScript and makes no requests for content.
import { type Milestone, statusLabels } from "./milestones.ts";
import { type ReplayColumn, replayColumns, replayQuery, replayRows } from "./replay-data.ts";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SQL_KEYWORDS = new Set([
  "ALL",
  "AND",
  "AS",
  "ASC",
  "BY",
  "DESC",
  "FROM",
  "GROUP",
  "LIMIT",
  "OR",
  "ORDER",
  "SELECT",
  "WHERE",
  "WITH",
]);

const SQL_TOKEN =
  /(--.*$)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/g;

/** One line of SQL as HTML, coloured with the editor's `--syntax-*` tokens. */
export function highlightSql(line: string): string {
  let html = "";
  let last = 0;
  for (const match of line.matchAll(SQL_TOKEN)) {
    const [text, comment, string, number, fn, word] = match;
    html += escapeHtml(line.slice(last, match.index));
    last = match.index + text.length;
    const kind = comment
      ? "comment"
      : string
        ? "string"
        : number
          ? "number"
          : fn
            ? "function"
            : word && SQL_KEYWORDS.has(word.toUpperCase())
              ? "keyword"
              : undefined;
    html += kind ? `<span class="sql-${kind}">${escapeHtml(text)}</span>` : escapeHtml(text);
  }
  return html + escapeHtml(line.slice(last));
}

/** The query in the replay's editor, with line numbers the way the editor draws them. */
export function renderSql(lines: readonly string[] = replayQuery.sql): string {
  return lines
    .map(
      (line, i) =>
        `<span class="sql-line"><span class="sql-gutter" aria-hidden="true">${i + 1}</span>${highlightSql(line)}</span>`,
    )
    .join(""); // each line is a block; a newline between them would add a blank line in the <pre>
}

function columnClass(column: ReplayColumn): string {
  const classes = column.type === "DOUBLE" ? ["num"] : [];
  if (column.optional) classes.push("optional");
  return classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
}

function formatCell(value: string | number | null): string {
  if (value === null) return '<span class="null">NULL</span>';
  return escapeHtml(typeof value === "number" ? value.toFixed(3) : value);
}

/** The replay's results grid: a real table, so screen readers can read the rows. */
export function renderGrid(): string {
  const head = replayColumns
    .map(
      (column) =>
        `<th scope="col"${columnClass(column)}><span class="col-name">${escapeHtml(column.name)}</span><span class="col-type">${column.type}</span></th>`,
    )
    .join("");
  const body = replayRows
    .map(
      (row, i) =>
        `<tr><th scope="row" class="row-number">${i + 1}</th>${row
          .map((value, c) => {
            const column = replayColumns[c];
            return `<td${column ? columnClass(column) : ""}>${formatCell(value)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const caption = `The first ${replayRows.length} of ${replayQuery.rowCount} rows`;
  return `<table class="grid"><caption class="sr-only">${caption}</caption><thead><tr><th scope="col" class="row-number"><span class="sr-only">Row</span></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** The roadmap as a row of indicator lamps: lit when done, marked when current, unlit when planned. */
export function renderMilestones(list: readonly Milestone[]): string {
  const items = list
    .map(
      (m) =>
        `<li class="milestone" data-status="${m.status}"${m.status === "current" ? ' aria-current="step"' : ""}><span class="milestone-lamp" aria-hidden="true"></span><span class="milestone-code">${escapeHtml(m.code)}</span><span class="milestone-name">${escapeHtml(m.name)}</span><span class="milestone-summary">${escapeHtml(m.summary)}</span><span class="milestone-status">${statusLabels[m.status]}</span></li>`,
    )
    .join("");
  return `<ol class="milestones">${items}</ol>`;
}

/** The current milestone, for the sentence above the lamps. */
export function currentMilestone(list: readonly Milestone[]): Milestone {
  const current = list.filter((m) => m.status === "current");
  if (current.length !== 1 || !current[0]) {
    throw new Error(`Exactly one milestone must be "current"; found ${current.length}`);
  }
  return current[0];
}

/**
 * The brand wordmark as inline SVG, so its lamp can mirror the replay. The letters take the
 * text colour (one SVG for both themes) and the lamp gets a halo for the "done" flash.
 */
export function inlineWordmark(svg: string): string {
  const lamp = svg.match(/<circle class="lamp" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"[^>]*\/>/);
  if (!lamp) throw new Error("The wordmark SVG has no lamp circle");
  const [circle, cx, cy, r] = lamp;
  return svg
    .replace(
      / width="\d+" height="\d+" role="img" aria-label="[^"]*"/,
      ' class="wordmark" aria-hidden="true"',
    )
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/fill="#1A201B"/g, 'fill="currentColor"')
    .replace(
      circle,
      `<circle class="wordmark-halo" cx="${cx}" cy="${cy}" r="${r}"/><circle class="wordmark-lamp" cx="${cx}" cy="${cy}" r="${r}"/>`,
    );
}
