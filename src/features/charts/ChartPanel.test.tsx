import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Float64, Table, Utf8, vectorFromArray } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartPanel } from "./ChartPanel";
import { setChartPreset } from "./chart-preset";
import { getShownChart, getShownChartPicture } from "./chart-settings";

// The last query's result has a time, a weekday and a measurement, like a table shown with Show
// rows; the engine answers every chart query with `chartRows`.
const engine = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/engine/engine", () => engine);
vi.mock("@/features/results/query-run", () => {
  const run = { state: "done", sql: "SELECT * FROM readings", rowCount: 9, durationMs: 1 };
  return { getQueryRun: () => run, subscribeToQueryRun: () => () => {} };
});
vi.mock("@/features/results/result-store", async () => {
  const { Float64, TimestampMillisecond, Utf8 } = await import("apache-arrow");
  const result = {
    columns: [
      { name: "ts", type: new TimestampMillisecond() },
      { name: "weekday", type: new Utf8() },
      { name: "v", type: new Float64() },
    ],
  };
  return { getResult: () => result, subscribeToResult: () => () => {} };
});
const draw = vi.hoisted(() => ({
  drawChart: vi.fn(() => () => {}),
  chartPng: vi.fn((_container: HTMLElement): string | undefined => undefined),
}));
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

  it("announces each chart it draws, so changing a setting is heard", async () => {
    engine.query.mockResolvedValue(chartRows);
    const user = userEvent.setup();
    render(<ChartPanel />);
    const label = "Bar chart of count(*) by weekday, 2 bars, highest 4 (3), lowest 2 (5)";
    expect(await screen.findByText(label)).toHaveAttribute("aria-live", "polite");

    await user.selectOptions(screen.getByLabelText("Chart type"), "line");
    expect(await screen.findByText(/^Line chart of /)).toHaveAttribute("aria-live", "polite");
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

  it("lets a Pareto chart sum a column instead of counting rows", async () => {
    engine.query.mockResolvedValue(chartRows);
    const user = userEvent.setup();
    render(<ChartPanel />);
    await user.selectOptions(screen.getByLabelText("Aggregate"), "avg");
    await user.selectOptions(screen.getByLabelText("Chart type"), "pareto");
    const aggregate = screen.getByLabelText("Aggregate");
    expect(aggregate).toHaveValue("count");
    expect([...aggregate.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "count",
      "sum",
    ]);
    expect(screen.queryByLabelText("Y")).toBeNull();

    await user.selectOptions(aggregate, "sum");
    expect(screen.getByLabelText("Y")).toHaveValue("v");
    await user.click(screen.getByRole("button", { name: "View as table" }));
    expect(
      await screen.findByRole("table", { name: "Pareto chart of sum(v) by weekday" }),
    ).toBeInTheDocument();
    expect(engine.query).toHaveBeenLastCalledWith(expect.stringContaining('sum("v")'));
  });

  it("opens in the chart preset for the last query, and ignores one for another query", async () => {
    engine.query.mockResolvedValue(chartRows);
    setChartPreset({ sql: "SELECT 1", type: "pareto", x: "weekday" });
    const { unmount } = render(<ChartPanel />);
    expect(screen.getByLabelText("Chart type")).toHaveValue("bar");
    unmount();

    setChartPreset({ sql: "SELECT * FROM readings", type: "bar", x: "ts", y: "v" });
    render(<ChartPanel />);
    expect(screen.getByLabelText("Chart type")).toHaveValue("bar");
    expect(screen.getByLabelText("X")).toHaveValue("ts");
    expect(screen.getByLabelText("Aggregate")).toHaveValue("sum");
    expect(screen.getByLabelText("Y")).toHaveValue("v");
    act(() => setChartPreset(null));
  });

  it("publishes the drawn chart's settings while it's on screen", async () => {
    engine.query.mockResolvedValue(chartRows);
    const user = userEvent.setup();
    const { unmount } = render(<ChartPanel />);
    await vi.waitFor(() =>
      expect(getShownChart()).toEqual({ type: "bar", x: "weekday", aggregate: "count" }),
    );

    await user.selectOptions(screen.getByLabelText("Aggregate"), "avg");
    await vi.waitFor(() =>
      expect(getShownChart()).toEqual({ type: "bar", x: "weekday", y: "v", aggregate: "avg" }),
    );

    unmount();
    expect(getShownChart()).toBeNull();
  });

  it("pictures the drawn chart for a report while it's on screen, but not as a table", async () => {
    engine.query.mockResolvedValue(chartRows);
    draw.chartPng.mockReturnValue("data:image/png;base64,AAAA");
    const user = userEvent.setup();
    const { unmount } = render(<ChartPanel />);
    await vi.waitFor(() => expect(draw.drawChart).toHaveBeenCalled());

    expect(await getShownChartPicture()).toEqual({
      png: "data:image/png;base64,AAAA",
      description: "Bar chart of count(*) by weekday, 2 bars, highest 4 (3), lowest 2 (5)",
    });

    await user.click(screen.getByRole("button", { name: "View as table" }));
    expect(await getShownChartPicture()).toBeNull();
    await user.click(screen.getByRole("button", { name: "View as table" }));

    unmount();
    expect(await getShownChartPicture()).toBeNull();
  });
});
