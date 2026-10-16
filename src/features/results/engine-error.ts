// Turning engine errors into readable messages. DuckDB reports errors as JSON (the engine sets
// errors_as_json), with the error type, where in the SQL it happened and, for unknown names, the
// names it would have accepted.
import { EngineCrashedError } from "@/engine/errors";

export type EngineError = {
  /** DuckDB's exception type, e.g. "Parser", "Catalog", "Binder", "Conversion". */
  type: string;
  /** e.g. "SYNTAX_ERROR", "MISSING_ENTRY", "COLUMN_NOT_FOUND", when DuckDB gives one. */
  subtype?: string;
  /** DuckDB's own message, which can span several lines. */
  message: string;
  /** Where in the SQL the error is, as an index into the SQL string. */
  position?: number;
  /** The name DuckDB didn't recognise, e.g. a table or column. */
  name?: string;
  /** What kind of thing `name` is, e.g. "Table". */
  entryType?: string;
  /** Names DuckDB suggests instead, best first. */
  candidates: readonly string[];
  /** For a function with no match, the call as DuckDB saw it, e.g. "sum(VARCHAR)". */
  call?: string;
  /** The engine itself stopped; the query may have been fine. */
  crashed: boolean;
};

type DuckDBErrorJson = {
  exception_type?: string;
  exception_message?: string;
  error_subtype?: string;
  position?: string;
  name?: string;
  type?: string;
  candidates?: string;
  call?: string;
};

/**
 * DuckDB's own catalog, which it suggests when nothing the user created is close ("Did you mean
 * duckdb_indexes?"). Never what the user meant.
 */
const SYSTEM_NAME = /^(duckdb_|pragma_|sqlite_|pg_|information_schema)/;

/** DuckDB counts positions in UTF-8 bytes; JavaScript strings count UTF-16 code units. */
function byteOffsetToIndex(sql: string, bytes: number): number {
  const encoded = new TextEncoder().encode(sql);
  return new TextDecoder().decode(encoded.subarray(0, Math.min(bytes, encoded.length))).length;
}

function parseJson(text: string): DuckDBErrorJson | null {
  // Some errors put a prefix such as "Parser Error: " before the JSON.
  const start = text.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start));
    return typeof parsed === "object" && parsed !== null && "exception_type" in parsed
      ? (parsed as DuckDBErrorJson)
      : null;
  } catch {
    return null;
  }
}

/** Reads an error thrown by the engine while running `sql`. */
export function parseEngineError(error: Error, sql: string): EngineError {
  if (error instanceof EngineCrashedError) {
    return { type: "Engine", message: error.message, candidates: [], crashed: true };
  }

  const json = parseJson(error.message);
  if (!json) {
    // Plain text, e.g. "Parser Error: syntax error at or near …", or not from DuckDB at all.
    const match = /^([A-Z][\w ]*?) Error: ([\s\S]*)$/.exec(error.message);
    return {
      type: match?.[1] ?? "Engine",
      message: match?.[2] ?? error.message,
      candidates: [],
      crashed: false,
    };
  }

  const position = json.position === undefined ? Number.NaN : Number(json.position);
  return {
    type: json.exception_type ?? "Engine",
    subtype: json.error_subtype,
    message: json.exception_message ?? error.message,
    position: Number.isInteger(position) ? byteOffsetToIndex(sql, position) : undefined,
    name: json.name,
    entryType: json.type,
    // Function candidates are signatures that contain commas themselves, so only names are split.
    candidates:
      json.candidates && json.error_subtype !== "NO_MATCHING_FUNCTION"
        ? json.candidates.split(",").filter((name) => name && !SYSTEM_NAME.test(name))
        : [],
    call: json.call,
    crashed: false,
  };
}

export type ErrorDescription = {
  /** One line saying what went wrong, in plain language. */
  title: string;
  /** What to try, when there's something useful to say. */
  hint?: string;
  /** e.g. "Parser error", for readers who know DuckDB. */
  label: string;
};

/** "machines" in the quotes the SQL would use. */
const quoted = (name: string) => `"${name}"`;

/** The first line of DuckDB's message: the rest is suggestions and candidate lists. */
const firstLine = (message: string) => message.split("\n")[0]?.trim() ?? message;

/** What went wrong and what to try, for the error panel. */
export function describeError(error: EngineError): ErrorDescription {
  const label = `${error.type} error`;

  if (error.crashed) {
    return {
      title: "The engine stopped",
      hint: "Restart the engine to carry on. Your imported files are loaded again automatically.",
      label: "Engine crash",
    };
  }

  if (error.subtype === "SYNTAX_ERROR" || error.type === "Parser") {
    const near = /at or near "(.*)"/.exec(error.message)?.[1];
    if (/at end of input/.test(error.message)) {
      return {
        title: "The query ends too soon",
        hint: "Something is missing at the end, such as a condition after WHERE or a closing bracket.",
        label,
      };
    }
    return {
      title: near ? `Syntax error near ${quoted(near)}` : "Syntax error",
      hint: "Check the marked spot for a typo or a missing comma, bracket or quote.",
      label,
    };
  }

  if (error.subtype === "MISSING_ENTRY" && error.name) {
    const kind = (error.entryType ?? "name").toLowerCase();
    const [suggestion] = error.candidates;
    return {
      title: `There's no ${kind} called ${quoted(error.name)}`,
      hint: suggestion
        ? `Did you mean ${quoted(suggestion)}?`
        : kind === "table"
          ? "Imported files are listed under Tables, with the name to use in SQL."
          : undefined,
      label,
    };
  }

  if (error.subtype === "COLUMN_NOT_FOUND" && error.name) {
    const [suggestion, ...others] = error.candidates;
    return {
      title: `There's no column called ${quoted(error.name)}`,
      hint: suggestion
        ? `Did you mean ${quoted(suggestion)}?${
            others.length > 0 ? ` Other columns: ${others.slice(0, 5).map(quoted).join(", ")}.` : ""
          }`
        : undefined,
      label,
    };
  }

  if (error.subtype === "NO_MATCHING_FUNCTION" && error.name) {
    const argumentTypes = error.call ? /\((.*)\)$/.exec(error.call)?.[1] : undefined;
    return {
      title: argumentTypes
        ? `${error.name}() doesn't accept ${argumentTypes}`
        : `${error.name}() doesn't accept these arguments`,
      hint: "Convert the argument to a type it accepts, for example column::DOUBLE.",
      label,
    };
  }

  if (/explicit type casts?/.test(error.message)) {
    return {
      title: "The types in this expression don't match",
      hint: "Add a cast so both sides have the same type, for example '5'::INTEGER.",
      label,
    };
  }

  if (error.type === "Conversion") {
    return {
      title: firstLine(error.message),
      hint: "Use TRY_CAST instead of CAST to get NULL for values that don't convert.",
      label,
    };
  }

  if (error.type === "Out of Memory") {
    return {
      title: "The query ran out of memory",
      hint: "Filter or aggregate in SQL, or add a LIMIT, so less data has to fit in the browser.",
      label,
    };
  }

  if (error.type === "IO" && /No files found/.test(error.message)) {
    return {
      title: firstLine(error.message),
      hint: "Import the file first, then query it by its name under Tables.",
      label,
    };
  }

  return { title: firstLine(error.message), label };
}

/**
 * The part of `sql` an error at `position` points at, as start and end indexes: the word, number
 * or quoted name there, or the last character when the error is at the very end.
 */
export function errorSpan(sql: string, position: number): { start: number; end: number } {
  if (position >= sql.length) return { start: Math.max(0, sql.length - 1), end: sql.length };
  const token = /^(?:"[^"]*"|'[^']*'|[\p{L}\p{N}_]+)/u.exec(sql.slice(position))?.[0];
  return { start: position, end: position + (token?.length || 1) };
}

/** The line of `sql` that `position` is on, with the column it's at and its 1-based number. */
export function lineAt(sql: string, position: number) {
  const start = sql.lastIndexOf("\n", position - 1) + 1;
  const end = sql.indexOf("\n", position);
  return {
    text: sql.slice(start, end === -1 ? undefined : end),
    column: position - start,
    number: sql.slice(0, start).split("\n").length,
  };
}
