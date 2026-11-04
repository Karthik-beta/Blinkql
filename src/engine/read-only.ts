// Telling a single statement that only reads apart from everything else, without a parser: enough
// to know whether running it a second time is harmless (see streamQuery in engine.ts).

/** Statements that start with one of these only read, unless they're a WITH in front of a write. */
const READS = /^(select|from|with|values|table|describe|show|summarize|pivot|unpivot)\b/i;
const WRITES = /\b(insert|update|delete|merge)\b/i;

/** `sql` with string literals, quoted names and comments blanked out, so their text can't match. */
function code(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const skipped =
      /^'(?:[^']|'')*'?/.exec(rest) ??
      /^"(?:[^"]|"")*"?/.exec(rest) ??
      /^--[^\n]*/.exec(rest) ??
      /^\/\*[\s\S]*?(?:\*\/|$)/.exec(rest) ??
      /^\$(\w*)\$[\s\S]*?(?:\$\1\$|$)/.exec(rest);
    if (skipped) {
      out += " ";
      i += skipped[0].length;
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

/**
 * Whether `sql` is a single statement that only reads, such as a SELECT, so running it again
 * changes nothing. Anything it can't be sure of, such as several statements, counts as not.
 */
export function isSingleRead(sql: string): boolean {
  const statement = code(sql).trim().replace(/;\s*$/, "");
  if (statement.includes(";")) return false;
  const start = statement.replace(/^\(+\s*/, "");
  const keyword = READS.exec(start)?.[1]?.toLowerCase();
  if (!keyword) return false;
  return keyword !== "with" || !WRITES.test(start);
}
