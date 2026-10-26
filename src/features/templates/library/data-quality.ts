import type { Template, TemplateSql } from "../template";

const MANDATORY = ["mandatory_1", "mandatory_2", "mandatory_3"] as const;

/** The name a quoted identifier stands for, as a SQL string, so a result can say which column. */
function nameOf(identifier: string): string {
  const name = identifier.slice(1, -1).replaceAll('""', '"');
  return `'${name.replaceAll("'", "''")}'`;
}

/** Whether `identifier` is a mapped column rather than the NULL an unmapped optional one gives. */
function mapped(identifier: string): boolean {
  return identifier !== "NULL";
}

/** A check that lists the rows of `import_rows` where `where` holds, as one issue each. */
function issues(check: string, column: string, value: string, where: string): string {
  return `SELECT ${check} AS issue, key_value, ${column} AS column_name, ${value} AS value, row_number
FROM import_rows WHERE ${where}`;
}

function checks(t: TemplateSql): string[] {
  const key = t.col("items", "key");
  const keyName = nameOf(key);
  // A blank key is reported as missing, not as a duplicate of every other blank key.
  const found = [
    issues("'Duplicate key'", keyName, "key_value", "key_present AND key_count > 1"),
    issues(`'Missing ' || ${keyName}`, keyName, "key_value", "NOT key_present"),
  ];
  for (const slot of MANDATORY) {
    const column = t.col("items", slot);
    if (!mapped(column)) continue;
    const name = nameOf(column);
    found.push(issues(`'Missing ' || ${name}`, name, slot, `nullif(trim(${slot}), '') IS NULL`));
  }
  const reference = t.col("items", "reference");
  if (mapped(reference)) {
    const refKey = t.col("refs", "key");
    found.push(
      issues(
        "'Broken reference'",
        nameOf(reference),
        "reference",
        `nullif(trim(reference), '') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM ${t.table("refs")} r WHERE CAST(r.${refKey} AS VARCHAR) = import_rows.reference
)`,
      ),
    );
  }
  return found;
}

export const dataQuality: Template = {
  id: "data-quality",
  title: "Data-quality checks for an import file",
  description:
    "Duplicate keys, missing mandatory fields and references to codes that don't exist, one row per issue found, before the file is migrated.",
  tables: [
    {
      key: "items",
      label: "Import file",
      sample: "item_import",
      columns: [
        {
          key: "key",
          label: "Key",
          type: "any",
          aliases: ["item_code", "code", "id", "item", "material", "sku"],
        },
        {
          key: "mandatory_1",
          label: "Mandatory field 1",
          type: "any",
          optional: true,
          aliases: ["description", "name", "item_description"],
        },
        {
          key: "mandatory_2",
          label: "Mandatory field 2",
          type: "any",
          optional: true,
          aliases: ["uom", "unit", "unit_of_measure", "base_unit"],
        },
        { key: "mandatory_3", label: "Mandatory field 3", type: "any", optional: true },
        {
          key: "reference",
          label: "Reference",
          type: "any",
          optional: true,
          aliases: ["plant_code", "plant", "site", "warehouse"],
        },
      ],
    },
    {
      key: "refs",
      label: "Reference table",
      sample: "plants",
      columns: [
        {
          key: "key",
          label: "Reference key",
          type: "any",
          aliases: ["plant_code", "plant", "code", "id"],
        },
      ],
    },
  ],
  sql: (t) => {
    // Values are compared as text, so a key typed as a number still matches its reference. The row
    // number counts from 1 in the order the file is read.
    const slots = MANDATORY.map((slot) => `CAST(${t.col("items", slot)} AS VARCHAR) AS ${slot}`);
    const key = t.col("items", "key");
    return `WITH import_rows AS (
  SELECT
    row_number() OVER () AS row_number,
    CAST(${key} AS VARCHAR) AS key_value,
    nullif(trim(CAST(${key} AS VARCHAR)), '') IS NOT NULL AS key_present,
    count(*) OVER (PARTITION BY CAST(${key} AS VARCHAR)) AS key_count,
    ${slots.join(",\n    ")},
    CAST(${t.col("items", "reference")} AS VARCHAR) AS reference
  FROM ${t.table("items")}
)
${checks(t).join("\nUNION ALL\n")}
ORDER BY row_number, issue`;
  },
  chart: { type: "bar", x: "issue", aggregate: "count" },
};
