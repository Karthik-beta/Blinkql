import type { Template } from "../template";

export const downtimePareto: Template = {
  id: "downtime-pareto",
  title: "Downtime Pareto",
  description:
    "Minutes of downtime and stops for each reason, largest first, with each reason's share and the running share of all downtime.",
  tables: [
    {
      key: "stops",
      label: "Breakdowns",
      sample: "breakdowns",
      columns: [
        {
          key: "reason",
          label: "Reason",
          type: "text",
          aliases: ["cause", "stop_reason", "downtime_reason", "fault", "failure", "code"],
        },
        {
          key: "started_at",
          label: "Started at",
          type: "temporal",
          aliases: ["start", "started", "start_time", "begin", "down_at", "from"],
        },
        {
          key: "ended_at",
          label: "Ended at",
          type: "temporal",
          aliases: ["end", "ended", "end_time", "finished_at", "up_at", "to"],
        },
        {
          key: "machine",
          label: "Machine",
          type: "text",
          optional: true,
          aliases: ["machine_id", "asset", "asset_id", "equipment", "station"],
        },
      ],
    },
  ],
  sql: (t) => {
    const minutes = `(epoch(${t.col("stops", "ended_at")}) - epoch(${t.col("stops", "started_at")})) / 60`;
    // Both orderings break ties on the reason, so the running share follows the rows' order.
    const order = "minutes DESC NULLS LAST, reason";
    return `WITH by_reason AS (
  SELECT
    ${t.col("stops", "reason")} AS reason,
    sum(${minutes}) AS minutes,
    count(*) AS stops,
    count(DISTINCT ${t.col("stops", "machine")}) AS machines
  FROM ${t.table("stops")}
  GROUP BY 1
)
SELECT
  reason,
  round(minutes, 1) AS downtime_min,
  stops,
  machines,
  round(100 * minutes / sum(minutes) OVER (), 2) AS share_pct,
  round(100 * sum(minutes) OVER (ORDER BY ${order} ROWS UNBOUNDED PRECEDING) / sum(minutes) OVER (), 2)
    AS cumulative_pct
FROM by_reason
ORDER BY ${order}`;
  },
  chart: { type: "pareto", x: "reason", y: "downtime_min", aggregate: "sum" },
};
