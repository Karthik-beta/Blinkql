// HTML helpers shared by the landing page and the docs, which both render at build time in Node.

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
  "BETWEEN",
  "BY",
  "CASE",
  "DESC",
  "DISTINCT",
  "ELSE",
  "END",
  "FROM",
  "GROUP",
  "HAVING",
  "IN",
  "IS",
  "JOIN",
  "LEFT",
  "LIKE",
  "LIMIT",
  "NOT",
  "NULL",
  "ON",
  "OR",
  "ORDER",
  "SELECT",
  "THEN",
  "WHEN",
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
    const name = fn ?? word;
    // A keyword stays a keyword before a bracket, as in `IN (…)` and `AS (…)`.
    const kind = comment
      ? "comment"
      : string
        ? "string"
        : number
          ? "number"
          : name && SQL_KEYWORDS.has(name.toUpperCase())
            ? "keyword"
            : fn
              ? "function"
              : undefined;
    html += kind ? `<span class="sql-${kind}">${escapeHtml(text)}</span>` : escapeHtml(text);
  }
  return html + escapeHtml(line.slice(last));
}
