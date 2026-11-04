// Finds the values written into a query, such as a customer's name in a WHERE clause, so sharing
// it can warn that the link shows them. A small scanner, not a parser: it only needs to tell
// literals apart from comments, names and keywords.

const WORD = /[A-Za-z_][A-Za-z0-9_$]*/y;
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;

/** Matches `pattern` (a sticky regex) at `at` in `sql`, or returns null. */
function matchAt(pattern: RegExp, sql: string, at: number): string | null {
  pattern.lastIndex = at;
  return pattern.exec(sql)?.[0] ?? null;
}

/** The end of the quoted text that starts at `at`, where a doubled quote stands for one. */
function quotedEnd(sql: string, at: number, quote: string): number {
  let i = at + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] !== quote) return i + 1;
      i += 2;
    } else i++;
  }
  return sql.length;
}

/**
 * The string ('...') and number literals in `sql`, as written, in order and without repeats.
 * Comments, quoted identifiers and the row counts after LIMIT and OFFSET are left out.
 */
export function literalValues(sql: string): string[] {
  const found = new Set<string>();
  // The keyword just before, to skip a LIMIT's or OFFSET's number.
  let previousWord: string | null = null;
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] ?? "";
    if (/\s/.test(char)) {
      i++;
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (char === "'" || char === '"') {
      const end = quotedEnd(sql, i, char);
      if (char === "'") found.add(sql.slice(i, end));
      i = end;
      previousWord = null;
    } else {
      const word = matchAt(WORD, sql, i);
      const number = word === null ? matchAt(NUMBER, sql, i) : null;
      if (number !== null && previousWord !== "LIMIT" && previousWord !== "OFFSET") {
        found.add(number);
      }
      i += (word ?? number ?? char).length;
      previousWord = word?.toUpperCase() ?? null;
    }
  }
  return [...found];
}
