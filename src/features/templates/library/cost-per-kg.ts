import type { Template } from "../template";

// Cost per kg is the total cost over the total weight, so heavy shipments count for more than
// light ones. Shipments still in transit count, as their cost is known when they're booked.
export const costPerKg: Template = {
  id: "cost-per-kg",
  title: "Cost per kg by lane and carrier",
  description:
    "Freight cost per kilogram for each carrier on each lane, cheapest carrier first within a lane, with the weight moved and what it cost.",
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
          key: "weight_kg",
          label: "Weight (kg)",
          type: "number",
          aliases: [
            "weight",
            "kg",
            "kgs",
            "weight_kgs",
            "gross_weight",
            "gross_weight_kg",
            "chargeable_weight",
            "chargeable_weight_kg",
          ],
        },
        {
          key: "cost",
          label: "Freight cost",
          type: "number",
          aliases: [
            "freight",
            "freight_charge",
            "freight_amount",
            "charge",
            "charges",
            "total_cost",
            "shipping_cost",
            "transport_cost",
            "amount",
          ],
        },
      ],
    },
  ],
  sql: (t) => {
    const weight = `sum(${t.col("shipments", "weight_kg")})`;
    const cost = `sum(${t.col("shipments", "cost")})`;
    return `SELECT
  concat(${t.col("shipments", "origin")}, ' → ', ${t.col("shipments", "destination")}) AS lane,
  ${t.col("shipments", "carrier")} AS carrier,
  count(*) AS shipments,
  round(${weight}, 1) AS weight_kg,
  round(${cost}, 2) AS cost,
  round(${cost} / nullif(${weight}, 0), 2) AS cost_per_kg
FROM ${t.table("shipments")}
GROUP BY 1, 2
ORDER BY 1, cost_per_kg ASC NULLS LAST, 2`;
  },
  chart: { type: "bar", x: "carrier", y: "cost_per_kg", aggregate: "avg" },
};
