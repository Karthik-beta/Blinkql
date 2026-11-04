import type { Template } from "../template";

export const qualityRejects: Template = {
  id: "quality-rejects",
  title: "Reject rate by machine",
  description:
    "Parts inspected and rejected on each machine, and the share rejected, worst machine first.",
  tables: [
    {
      key: "checks",
      label: "Quality checks",
      sample: "quality_checks",
      columns: [
        {
          key: "machine_id",
          label: "Machine",
          type: "text",
          aliases: ["machine", "asset", "asset_id", "equipment", "station"],
        },
        {
          key: "checked_at",
          label: "Checked at",
          type: "temporal",
          optional: true,
          aliases: ["timestamp", "time", "date", "inspected_at"],
        },
        {
          key: "inspected",
          label: "Inspected",
          type: "number",
          aliases: ["quantity", "qty", "parts", "units", "checked"],
        },
        {
          key: "rejected",
          label: "Rejected",
          type: "number",
          aliases: ["rejects", "defects", "scrap", "failed", "ng"],
        },
      ],
    },
  ],
  params: [
    {
      key: "min_inspected",
      label: "Minimum inspected",
      type: "number",
      default: 0,
      description: "Leave out machines with fewer inspected parts than this.",
    },
  ],
  sql: (t) => {
    const inspected = `sum(${t.col("checks", "inspected")})`;
    const rejected = `sum(${t.col("checks", "rejected")})`;
    return `SELECT
  ${t.col("checks", "machine_id")} AS machine_id,
  CAST(${inspected} AS BIGINT) AS inspected,
  CAST(${rejected} AS BIGINT) AS rejected,
  round(100 * ${rejected} / nullif(${inspected}, 0), 2) AS reject_rate_pct,
  min(${t.col("checks", "checked_at")}) AS first_check,
  max(${t.col("checks", "checked_at")}) AS last_check
FROM ${t.table("checks")}
GROUP BY 1
HAVING ${inspected} >= ${t.param("min_inspected")}
ORDER BY reject_rate_pct DESC NULLS LAST, 1`;
  },
  chart: { type: "bar", x: "machine_id", y: "reject_rate_pct", aggregate: "avg" },
};
