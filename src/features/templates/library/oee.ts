import type { Template } from "../template";

export const oee: Template = {
  id: "oee",
  title: "OEE by machine",
  description:
    "Each machine's overall equipment effectiveness over its planned minutes: availability, performance and quality, best machine first.",
  tables: [
    {
      key: "telemetry",
      label: "Machine telemetry",
      sample: "machine_telemetry",
      columns: [
        {
          key: "machine_id",
          label: "Machine",
          type: "text",
          aliases: ["machine", "asset", "asset_id", "equipment", "station"],
        },
        {
          key: "minute_at",
          label: "Minute",
          type: "temporal",
          optional: true,
          aliases: ["timestamp", "time", "date"],
        },
        {
          key: "planned",
          label: "Planned",
          type: "any",
          aliases: ["scheduled", "is_planned", "planned_time"],
        },
        {
          key: "running",
          label: "Running",
          type: "any",
          aliases: ["is_running", "producing", "active"],
        },
        {
          key: "ideal_cycle_s",
          label: "Ideal cycle (s)",
          type: "number",
          aliases: ["ideal_cycle", "cycle_time", "ideal_cycle_time", "ct"],
        },
        {
          key: "total_count",
          label: "Total count",
          type: "number",
          aliases: ["total", "parts", "units", "output"],
        },
        {
          key: "good_count",
          label: "Good count",
          type: "number",
          aliases: ["good", "good_parts", "good_units", "ok_count"],
        },
      ],
    },
  ],
  sql: (t) => {
    const machine = t.col("telemetry", "machine_id");
    const planned = t.col("telemetry", "planned");
    const running = t.col("telemetry", "running");
    const ideal = t.col("telemetry", "ideal_cycle_s");
    const total = t.col("telemetry", "total_count");
    const good = t.col("telemetry", "good_count");
    const minute = t.col("telemetry", "minute_at");
    return `WITH counted AS (
  SELECT
    ${machine} AS machine_id,
    count(*) FILTER (WHERE ${planned}) AS planned_min,
    count(*) FILTER (WHERE ${planned} AND ${running}) AS run_min,
    sum(${ideal} * ${total}) FILTER (WHERE ${planned} AND ${running}) AS ideal_s,
    sum(${total}) FILTER (WHERE ${planned}) AS total,
    sum(${good}) FILTER (WHERE ${planned}) AS good,
    min(${minute}) FILTER (WHERE ${planned}) AS first_minute,
    max(${minute}) FILTER (WHERE ${planned}) AS last_minute
  FROM ${t.table("telemetry")}
  GROUP BY 1
), rates AS (
  SELECT
    machine_id,
    planned_min,
    run_min,
    first_minute,
    last_minute,
    run_min / nullif(planned_min, 0) AS availability,
    ideal_s / nullif(run_min * 60, 0) AS performance,
    good / nullif(total, 0) AS quality
  FROM counted
)
SELECT
  machine_id,
  CAST(planned_min AS BIGINT) AS planned_min,
  CAST(run_min AS BIGINT) AS run_min,
  round(100 * availability, 1) AS availability_pct,
  round(100 * performance, 1) AS performance_pct,
  round(100 * quality, 1) AS quality_pct,
  round(100 * availability * performance * quality, 1) AS oee_pct,
  first_minute,
  last_minute
FROM rates
ORDER BY oee_pct DESC NULLS LAST, 1`;
  },
  chart: { type: "bar", x: "machine_id", y: "oee_pct", aggregate: "avg" },
};
