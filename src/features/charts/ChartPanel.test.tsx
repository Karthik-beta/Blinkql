import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Float64, Table, Utf8, vectorFromArray } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartPanel } from "./ChartPanel";

// The last query's result has a weekday and a measurement; the engine answers every chart query
// with `chartRows`.
const engine = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/engine/engine", () => engine);
vi.mock("@/features/results/query-run", () => {
  const run = { state: "done", sql: "SELECT * FROM readings", rowCount: 9, durationMs: 1 };
  return { getQueryRun: () => run, subscribeToQueryRun: () => () => {} };
});
vi.mock("@/features/results/result-store", async () => {
  const { Float64, Utf8 } = await import("apache-arrow");
  const result = {
    columns: [
      { name: "weekday", type: new Utf8() },
      { name: "v", type: new Float64() },
    ],
  };
  return { getResult: () => result, subscribeToResult: () => () => {} };
});
const draw = vi.hoisted(() => ({ drawChart: vi.fn(() => () => {}) }));
vi.mock("./draw-chart", () => draw);

const chartRows = new Table({
  x: vectorFromArray(["3", "5"], new Utf8()),
  y: vectorFromArray([4, 2], new Float64()),
});

describe("ChartPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("names the chart with a summary of its data", async () => {
    engine.query.mockResolvedValue(chartRows);
    render(<ChartPanel />);
    await vi.waitFor(() => expect(draw.drawChart).toHaveBeenCalled());
    expect(draw.drawChart).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        label: "Bar chart of count(*) by weekday, 2 bars, highest 4 (3), lowest 2 (5)",
      }),
    );
  });

  it("shows the chart's data as a table", async () => {
    engine.query.mockResolvedValue(chartRows);
    const user = userEvent.setup();
    render(<ChartPanel />);
    const toggle = screen.getByRole("button", { name: "View as table" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const table = await screen.findByRole("table", { name: "Bar chart of count(*) by weekday" });
    const rows = within(table)
      .getAllByRole("row")
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["weekday", "count(*)"],
      ["3", "4"],
      ["5", "2"],
    ]);

    await user.click(toggle);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("adds the cumulative percentage to a Pareto chart's table", async () => {
    engine.query.mockResolvedValue(
      new Table({
        x: vectorFromArray(["3", "5"], new Utf8()),
        y: vectorFromArray([3, 1], new Float64()),
        cumulative_pct: vectorFromArray([75, 100], new Float64()),
      }),
    );
    const user = userEvent.setup();
    render(<ChartPanel />);
    await user.selectOptions(screen.getByLabelText("Chart type"), "pareto");
    await user.click(screen.getByRole("button", { name: "View as table" }));
    const table = await screen.findByRole("table", { name: "Pareto chart of count(*) by weekday" });
    const rows = within(table)
      .getAllByRole("row")
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["weekday", "count(*)", "Cumulative %"],
      ["3", "3", "75"],
      ["5", "1", "100"],
    ]);
  });
});
