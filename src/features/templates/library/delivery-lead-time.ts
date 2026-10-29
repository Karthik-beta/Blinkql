import type { Template } from "../template";

// Lead time is counted in calendar days from shipping to delivery. The 90th percentile is the
// time within which 9 in 10 shipments on the lane arrive. Shipments still in transit are counted
// but have no lead time yet.
export const deliveryLeadTime: Template = {
  id: "delivery-lead-time",
  title: "Delivery lead time by lane",
  description:
    "Median and 90th percentile days from shipping to delivery on each lane, slowest lane first, with the number of shipments delivered and still in transit.",
  tables: [
    {
      key: "shipments",
      label: "Shipments",
      sample: "shipments",
      columns: [
        {
          key: "origin",
          label: "Origin",
          type: "text",
          aliases: ["from", "ship_from", "origin_city", "from_city", "origin_location"],
        },
        {
          key: "destination",
          label: "Destination",
          type: "text",
          aliases: ["to", "dest", "ship_to", "destination_city", "to_city", "destination_location"],
        },
        {
          key: "ship_date",
          label: "Shipped",
          type: "temporal",
          aliases: [
            "shipped_at",
            "shipped_on",
            "shipped_date",
            "shipment_date",
            "dispatch_date",
            "dispatched_at",
            "dispatched_on",
            "pickup_date",
            "picked_up_at",
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
  sql: (t) => `WITH shipments AS (
  SELECT
    concat(${t.col("shipments", "origin")}, ' → ', ${t.col("shipments", "destination")}) AS lane,
    date_diff(
      'day',
      CAST(${t.col("shipments", "ship_date")} AS DATE),
      CAST(${t.col("shipments", "delivered_date")} AS DATE)
    ) AS days
  FROM ${t.table("shipments")}
)
SELECT
  lane,
  count(days) AS delivered,
  count(*) - count(days) AS in_transit,
  round(median(days), 1) AS median_days,
  round(quantile_cont(days, 0.9), 1) AS p90_days
FROM shipments
GROUP BY 1
ORDER BY p90_days DESC NULLS LAST, median_days DESC, 1`,
  chart: { type: "bar", x: "lane", y: "p90_days", aggregate: "avg" },
};
