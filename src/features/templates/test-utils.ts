// Helpers for template tests, which run templates in Node's DuckDB to show that each one works on
// its sample and on a user's file whose columns are named differently.
import type { DuckDBConnection } from "@duckdb/node-api";
import { quoteIdentifier } from "@/features/catalog/formats";
import { samples } from "@/features/samples/samples";
import {
  autoMap,
  type CatalogTable,
  type Mapping,
  mappingProblems,
  renderTemplate,
  type Template,
  type TemplateParams,
} from "./template";

/** The connection's tables and their columns, as the catalog describes them. */
export async function catalogTables(connection: DuckDBConnection): Promise<CatalogTable[]> {
  const reader = await connection.runAndReadAll(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'main' ORDER BY table_name, ordinal_position`,
  );
  const tables = new Map<string, { name: string; type: string }[]>();
  for (const [table, name, type] of reader.getRowsJS() as [string, string, string][]) {
    tables.set(table, [...(tables.get(table) ?? []), { name, type }]);
  }
  return [...tables].map(([name, columns]) => ({ name, columns }));
}

/**
 * Runs `template` and returns its result. Without a mapping it's mapped automatically to the
 * connection's tables; a mapping with problems throws them.
 */
export async function runTemplate(
  connection: DuckDBConnection,
  template: Template,
  options: { mapping?: Mapping; params?: TemplateParams } = {},
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  const tables = await catalogTables(connection);
  const mapping = options.mapping ?? autoMap(template, tables);
  const problems = mappingProblems(template, mapping, tables);
  if (problems.length > 0) throw new Error(problems.map(({ message }) => message).join(" "));
  const reader = await connection.runAndReadAll(renderTemplate(template, mapping, options.params));
  return { columns: reader.columnNames(), rows: reader.getRowObjectsJS() };
}

/**
 * Copies `table` to a new table `as`, with columns renamed as `renames` says (old name to new),
 * like a user's own file holding the same data. Returns the new table's name.
 */
export async function renamedCopy(
  connection: DuckDBConnection,
  table: string,
  renames: Record<string, string>,
  as = `${table}_renamed`,
): Promise<string> {
  const pairs = Object.entries(renames).map(
    ([from, to]) => `${quoteIdentifier(from)} AS ${quoteIdentifier(to)}`,
  );
  await connection.run(
    `CREATE OR REPLACE TABLE ${quoteIdentifier(as)} AS
     SELECT * RENAME (${pairs.join(", ")}) FROM ${quoteIdentifier(table)}`,
  );
  return as;
}

/** Creates the named sample tables, as loadSample() would, in `connection`. */
export async function createSamples(
  connection: DuckDBConnection,
  ...names: readonly string[]
): Promise<void> {
  for (const name of names) {
    const sample = samples.find((other) => other.name === name);
    if (!sample) throw new Error(`No sample called ${name}`);
    await connection.run(`CREATE OR REPLACE TABLE ${quoteIdentifier(name)} AS ${sample.sql}`);
  }
}
