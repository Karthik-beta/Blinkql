import type { Template } from "../template";

export const shiftOutput: Template = {
  id: "shift-output",
  title: "Output by production day and shift",
  description:
    "Units and events per production day and shift. The day starts with the first shift, so a " +
    "night shift that runs past midnight is reported on the day it started.",
  tables: [
    {
      key: "events",
      label: "Output events",
      sample: "shift_output",
      columns: [
        {
          key: "event_at",
          label: "Event at",
          type: "temporal",
          aliases: ["timestamp", "time", "date", "reported_at", "recorded_at"],
        },
        {
          key: "units",
          label: "Units",
          type: "number",
          aliases: ["quantity", "qty", "parts", "count", "output", "good"],
        },
        {
          key: "machine",
          label: "Machine",
          type: "text",
          optional: true,
          aliases: ["machine_id", "asset", "asset_id", "equipment", "station", "line"],
        },
      ],
    },
  ],
  params: [
    {
      key: "shift_starts",
      label: "Shift starts",
      type: "text",
      default: "06:00, 14:00, 22:00",
      description: "When each shift starts, comma-separated. The first one starts the day.",
    },
    {
      key: "shift_names",
      label: "Shift names",
      type: "text",
      default: "A, B, C",
      description: "A name for each shift, in the same order as the starts.",
    },
  ],
  sql: (t) => `WITH config AS (
  SELECT
    list_transform(string_split(${t.param("shift_starts")}, ','), s -> try_cast(trim(s) AS TIME)) AS starts,
    list_transform(string_split(${t.param("shift_names")}, ','), s -> trim(s)) AS names
),
-- Each shift and how many seconds after the first shift's start it begins.
shifts AS (
  SELECT
    coalesce(nullif(names[i], ''), 'Shift ' || i) AS shift,
    CASE WHEN starts[i] IS NULL
      THEN error('Shift starts must be times such as 06:00, separated by commas.')
      ELSE (epoch(starts[i]) - epoch(starts[1]) + 86400) % 86400
    END AS starts_after
  FROM config, range(1, len(starts) + 1) r(i)
),
-- Moving every event back by the first shift's start puts it on its production day's date.
events AS (
  SELECT
    CAST(${t.col("events", "event_at")} AS TIMESTAMP)
      - to_seconds((SELECT epoch(starts[1]) FROM config)) AS day_time,
    ${t.col("events", "machine")} AS machine,
    ${t.col("events", "units")} AS units
  FROM ${t.table("events")}
)
SELECT
  CAST(day_time AS DATE) AS production_day,
  shifts.shift,
  events.machine,
  CAST(sum(units) AS BIGINT) AS units,
  count(*) AS events
FROM events
ASOF JOIN shifts ON epoch(CAST(day_time AS TIME)) >= shifts.starts_after
GROUP BY production_day, shifts.shift, shifts.starts_after, events.machine
ORDER BY production_day, shifts.starts_after, events.machine`,
  chart: { type: "bar", x: "shift", y: "units", aggregate: "sum" },
};
