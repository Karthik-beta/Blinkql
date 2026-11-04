// Analysis templates: SQL written against named columns rather than a particular file. A template
// declares the tables and columns it needs; the user maps their own tables and columns to them,
// and the template's SQL is rendered with the mapped names quoted in.
import type { ImportedTable } from "@/features/catalog/catalog";
import { quoteIdentifier } from "@/features/catalog/formats";
import type { Aggregate, ChartType } from "@/features/charts/chart-sql";

/** What a template column holds; "any" accepts every column. */
export type ColumnType = "text" | "number" | "temporal" | "any";

export type TemplateColumn = {
  key: string;
  label: string;
  type: ColumnType;
  /** An optional column can be left unmapped; the SQL then reads it as NULL. */
  optional?: boolean;
  /** Other names auto-matching accepts, e.g. ["machine", "asset_id"]. */
  aliases?: readonly string[];
};

export type TemplateTable = {
  key: string;
  label: string;
  /** The sample table it runs on out of the box. */
  sample: string;
  columns: readonly TemplateColumn[];
};

export type TemplateParam = {
  key: string;
  label: string;
  type: "number" | "text";
  default: string | number;
  description?: string;
};

/** The chart the result opens in. x and y name columns of the template's result. */
export type TemplateChart = {
  type: ChartType;
  x: string;
  y?: string;
  /** Defaults to "sum" with a y, otherwise "count". */
  aggregate?: Aggregate;
};

/** What a template's `sql` builds its query from. */
export type TemplateSql = {
  /** The mapped table's name, quoted. */
  table(key: string): string;
  /** The mapped column's name, quoted, or NULL for an unmapped optional column. */
  col(tableKey: string, colKey: string): string;
  /** The parameter's value as a SQL literal. */
  param(key: string): string;
};

export type Template = {
  id: string;
  title: string;
  description: string;
  tables: readonly TemplateTable[];
  params?: readonly TemplateParam[];
  /**
   * The analysis SQL. `t.table(key)` and `t.col(tableKey, colKey)` return quoted identifiers of the
   * user's mapped table/column (an unmapped optional column gives NULL); `t.param(key)` returns the
   * parameter as a SQL literal.
   */
  sql(t: TemplateSql): string;
  chart?: TemplateChart;
};

/** For each template table, the user's table and, for each template column, its column. */
export type Mapping = Record<string, { table: string; columns: Record<string, string> }>;

/** Parameter values by key, as typed; a missing one takes its default. */
export type TemplateParams = Record<string, string | number>;

/** A table templates can map to: a catalog table, or one described the same way. */
export type CatalogTable = Pick<ImportedTable, "name" | "columns">;

/** Something wrong with a mapping, and the template table and column it's about. */
export type MappingProblem = { table: string; column?: string; message: string };

/** The ColumnType a DuckDB type name (such as VARCHAR or DECIMAL(18,3)) belongs to. */
export function columnTypeOf(duckdbType: string): Exclude<ColumnType, "any"> | null {
  const type = duckdbType.toUpperCase();
  // Anchored at both ends, so a list such as INTEGER[] or a STRUCT isn't taken for its element.
  if (
    /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|FLOAT|REAL|DOUBLE|(DECIMAL|NUMERIC)(\(.*\))?)$/.test(type)
  ) {
    return "number";
  }
  if (/^(DATE|TIMESTAMP(_S|_MS|_NS)?( WITH TIME ZONE)?|TIMESTAMPTZ)$/.test(type)) return "temporal";
  if (/^(VARCHAR|CHAR|TEXT|STRING|UUID|ENUM\(.*\))$/.test(type)) return "text";
  return null;
}

/** Whether a column of `duckdbType` can stand for a column of `wanted`. */
export function fitsType(wanted: ColumnType, duckdbType: string): boolean {
  if (wanted === "any") return true;
  const actual = columnTypeOf(duckdbType);
  // Labels such as machine ids are often numbers in someone's file, and read just as well.
  return actual === wanted || (wanted === "text" && actual === "number");
}

/** A name compared case-, space-, underscore- and hyphen-insensitively. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

/** The best match in `table` for each of `wanted`'s columns, by name and type. */
export function autoMapColumns(wanted: TemplateTable, table: CatalogTable): Record<string, string> {
  const columns: Record<string, string> = {};
  const used = new Set<string>();
  for (const column of wanted.columns) {
    const names = new Set([column.key, column.label, ...(column.aliases ?? [])].map(normalise));
    const match = table.columns.find(
      ({ name, type }) =>
        !used.has(name) && names.has(normalise(name)) && fitsType(column.type, type),
    );
    if (match) {
      columns[column.key] = match.name;
      used.add(match.name);
    }
  }
  return columns;
}

/**
 * A best guess at the mapping: each template table goes to its sample table if that's loaded,
 * otherwise to the table that matches most of its columns. Tables nothing matches stay unmapped.
 */
export function autoMap(template: Template, tables: readonly CatalogTable[]): Mapping {
  const mapping: Mapping = {};
  for (const wanted of template.tables) {
    let best: { table: string; columns: Record<string, string> } | null = null;
    let bestCount = 0;
    for (const table of tables) {
      const columns = autoMapColumns(wanted, table);
      if (table.name === wanted.sample) {
        best = { table: table.name, columns };
        break;
      }
      const count = Object.keys(columns).length;
      if (count > bestCount) {
        best = { table: table.name, columns };
        bestCount = count;
      }
    }
    if (best) mapping[wanted.key] = best;
  }
  return mapping;
}

/** What stops `mapping` from running `template`, in the order the form shows it. */
export function mappingProblems(
  template: Template,
  mapping: Mapping,
  tables: readonly CatalogTable[],
): MappingProblem[] {
  const problems: MappingProblem[] = [];
  for (const wanted of template.tables) {
    const mapped = mapping[wanted.key];
    const table = mapped && tables.find(({ name }) => name === mapped.table);
    if (!mapped?.table) {
      problems.push({ table: wanted.key, message: `Choose a table for ${wanted.label}.` });
      continue;
    }
    if (!table) {
      problems.push({ table: wanted.key, message: `There's no table named ${mapped.table}.` });
      continue;
    }
    for (const column of wanted.columns) {
      const name = mapped.columns[column.key];
      const found = name ? table.columns.find((candidate) => candidate.name === name) : undefined;
      let message: string | null = null;
      if (!name) {
        if (!column.optional) message = `Choose a column for ${column.label}.`;
      } else if (!found) {
        message = `${table.name} has no column named ${name}.`;
      } else if (!fitsType(column.type, found.type)) {
        message = `${column.label} needs a ${column.type} column; ${name} is ${found.type}.`;
      }
      if (message) problems.push({ table: wanted.key, column: column.key, message });
    }
  }
  return problems;
}

function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * `template`'s SQL for `mapping` and `params`, headed by a comment with its title. Throws when the
 * SQL asks for an unmapped table or required column, or a parameter that isn't a valid value.
 */
export function renderTemplate(
  template: Template,
  mapping: Mapping,
  params: TemplateParams = {},
): string {
  const tableOf = (key: string) => {
    const wanted = template.tables.find((table) => table.key === key);
    if (!wanted) throw new Error(`${template.id} has no table ${key}`);
    const mapped = mapping[key];
    if (!mapped?.table) throw new Error(`Choose a table for ${wanted.label}.`);
    return { wanted, mapped };
  };
  const sql = template.sql({
    table: (key) => quoteIdentifier(tableOf(key).mapped.table),
    col: (tableKey, colKey) => {
      const { wanted, mapped } = tableOf(tableKey);
      const column = wanted.columns.find(({ key }) => key === colKey);
      if (!column) throw new Error(`${template.id} has no column ${tableKey}.${colKey}`);
      const name = mapped.columns[colKey];
      if (name) return quoteIdentifier(name);
      if (column.optional) return "NULL";
      throw new Error(`Choose a column for ${column.label}.`);
    },
    param: (key) => {
      const param = template.params?.find((candidate) => candidate.key === key);
      if (!param) throw new Error(`${template.id} has no parameter ${key}`);
      const value = params[key] ?? param.default;
      if (param.type === "text") return quoteString(String(value));
      const number = typeof value === "number" ? value : Number(String(value).trim() || Number.NaN);
      if (!Number.isFinite(number)) throw new Error(`${param.label} must be a number.`);
      return String(number);
    },
  });
  return `-- ${template.title.replaceAll("\n", " ")}\n${sql.trim()}\n`;
}
