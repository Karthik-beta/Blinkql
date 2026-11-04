import type { Template } from "../template";

// Dates are compared as calendar days, so a delivery late in the evening of the promised day is on
// time. A shipment with no delivery date is still in transit: it's counted, but left out of the
// rate, as it may yet arrive on time.
export const onTimeDelivery: Template = {
  id: "on-time-delivery",
  title: "On-time delivery by carrier",
  description:
    "The share of each carrier's delivered shipments that arrived by the promised date, worst carrier first. Shipments still in transit are counted but left out of the rate.",
  tables: [
    {
      key: "shipments",
      label: "Shipments",
      sample: "shipments",
      columns: [
        {
          key: "carrier",
          label: "Carrier",
          type: "text",
          aliases: [
            "carrier_name",
            "carrier_id",
            "carrier_code",
            "scac",
            "haulier",
            "hauler",
            "transporter",
            "courier",
            "forwarder",
          ],
        },
        {
          key: "promised_date",
          label: "Promised delivery",
          type: "temporal",
          aliases: [
            "promised",
            "promised_at",
            "promised_delivery_date",
            "due_date",
            "due_at",
            "delivery_due",
            "committed_date",
            "expected_delivery",
            "expected_delivery_date",
            "eta",
          ],
        },
        {
          key: "delivered_date",
          label: "Delivered",
          type: "temporal",
          aliases: [
            "delivered_at",
            "delivered_on",
            "delivery_date",
            "actual_delivery",
            "actual_delivery_date",
            "pod_date",
            "received_date",
            "arrived_at",
          ],
        },
      ],
    },
  ],
  params: [
    {
      key: "grace_days",
      label: "Days of grace",
      type: "number",
      default: 0,
      description: "Count deliveries up to this many days after the promised date as on time.",
    },
  ],
  sql: (t) => {
    const delivered = `CAST(${t.col("shipments", "delivered_date")} AS DATE)`;
    const promised = `CAST(${t.col("shipments", "promised_date")} AS DATE)`;
    const late = `days_late > ${t.param("grace_days")}`;
    return `WITH shipments AS (
  SELECT
    ${t.col("shipments", "carrier")} AS carrier,
    ${delivered} AS delivered_date,
    date_diff('day', ${promised}, ${delivered}) AS days_late
  FROM ${t.table("shipments")}
)
SELECT
  carrier,
  count(*) AS shipments,
  count(delivered_date) AS delivered,
  count(*) FILTER (WHERE NOT (${late})) AS on_time,
  count(*) FILTER (WHERE ${late}) AS late,
  count(*) - count(delivered_date) AS in_transit,
  round(100 * count(*) FILTER (WHERE NOT (${late})) / nullif(count(delivered_date), 0), 1)
    AS on_time_pct,
  round(avg(days_late) FILTER (WHERE ${late}), 1) AS avg_days_late
FROM shipments
GROUP BY 1
ORDER BY on_time_pct ASC NULLS LAST, 1`;
  },
  chart: { type: "bar", x: "carrier", y: "on_time_pct", aggregate: "avg" },
};
