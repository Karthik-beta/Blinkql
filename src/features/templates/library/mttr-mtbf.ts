import type { Template } from "../template";

// MTTR is the average repair time (ended minus started). MTBF is the average uptime between
// failures: each failure's start minus the previous failure's end on the same machine. A machine
// with one failure has no uptime gap, so its MTBF is NULL.
export const mttrMtbf: Template = {
  id: "mttr-mtbf",
  title: "MTTR and MTBF per machine",
  description:
    "Mean time to repair and mean time between failures for each machine, worst MTBF first.",
  tables: [
    {
      key: "breakdowns",
      label: "Breakdown log",
      sample: "breakdowns",
      columns: [
        {
          key: "machine",
          label: "Machine",
          type: "text",
          aliases: ["machine_id", "asset", "asset_id", "equipment", "station"],
        },
        {
          key: "started_at",
          label: "Started at",
          type: "temporal",
          aliases: ["start", "start_time", "from", "began_at"],
        },
        {
          key: "ended_at",
          label: "Ended at",
          type: "temporal",
          aliases: ["end", "end_time", "to", "finished_at", "stopped_at"],
        },
      ],
    },
  ],
  sql: (t) => `WITH failures AS (
  SELECT
    ${t.col("breakdowns", "machine")} AS machine_id,
    ${t.col("breakdowns", "started_at")} AS started_at,
    ${t.col("breakdowns", "ended_at")} AS ended_at,
    lag(${t.col("breakdowns", "ended_at")}) OVER (
      PARTITION BY ${t.col("breakdowns", "machine")} ORDER BY ${t.col("breakdowns", "started_at")}
    ) AS previous_ended_at
  FROM ${t.table("breakdowns")}
)
SELECT
  machine_id,
  count(*) AS failures,
  round(sum(date_diff('second', started_at, ended_at)) / 3600, 2) AS downtime_h,
  round(avg(date_diff('second', started_at, ended_at)) / 60, 1) AS mttr_min,
  round(avg(date_diff('second', previous_ended_at, started_at)) / 3600, 2) AS mtbf_h
FROM failures
GROUP BY 1
ORDER BY mtbf_h ASC NULLS LAST, 1`,
  chart: { type: "bar", x: "machine_id", y: "mtbf_h", aggregate: "avg" },
};
