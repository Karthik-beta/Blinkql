import type { Template, TemplateColumn } from "../template";

const key: TemplateColumn = {
  key: "key",
  label: "Key",
  type: "text",
  aliases: ["order_id", "order", "work_order", "order_no", "order_number", "document"],
};

const quantity = (aliases: readonly string[]): TemplateColumn => ({
  key: "quantity",
  label: "Quantity",
  type: "number",
  aliases: ["qty", ...aliases],
});

export const reconciliation: Template = {
  id: "reconciliation",
  title: "Two-file reconciliation",
  description:
    "Every key where two systems disagree, such as ERP and MES: missing on one side or with a " +
    "different quantity, largest variance first.",
  tables: [
    {
      key: "left",
      label: "First system (e.g. ERP)",
      sample: "erp_orders",
      columns: [key, quantity(["reported_qty", "confirmed_qty", "booked_qty"])],
    },
    {
      key: "right",
      label: "Second system (e.g. MES)",
      sample: "mes_orders",
      columns: [key, quantity(["good_qty", "produced_qty", "output"])],
    },
  ],
  params: [
    {
      key: "tolerance",
      label: "Tolerance",
      type: "number",
      default: 0,
      description: "Leave out keys on both sides whose quantities differ by no more than this.",
    },
  ],
  sql: (t) => {
    // Each side summed per key; keys are compared as text so 1001 matches '1001'.
    const side = (table: string) => `SELECT CAST(${t.col(table, "key")} AS VARCHAR) AS key,
    sum(${t.col(table, "quantity")}) AS qty
  FROM ${t.table(table)}
  WHERE ${t.col(table, "key")} IS NOT NULL
  GROUP BY 1`;
    return `WITH first_system AS (
  ${side("left")}
), second_system AS (
  ${side("right")}
), joined AS (
  SELECT
    coalesce(f.key, s.key) AS key,
    f.key IS NOT NULL AS in_first,
    s.key IS NOT NULL AS in_second,
    f.qty AS left_qty,
    s.qty AS right_qty,
    coalesce(s.qty, 0) - coalesce(f.qty, 0) AS variance
  FROM first_system f
  FULL OUTER JOIN second_system s ON f.key = s.key
)
SELECT
  key,
  left_qty,
  right_qty,
  variance,
  abs(variance) AS abs_variance,
  CASE WHEN NOT in_second THEN 'Only in first'
    WHEN NOT in_first THEN 'Only in second'
    ELSE 'Quantities differ' END AS status
FROM joined
WHERE NOT (in_first AND in_second) OR abs(variance) > ${t.param("tolerance")}
ORDER BY abs_variance DESC, key`;
  },
  chart: { type: "bar", x: "key", y: "abs_variance" },
};
