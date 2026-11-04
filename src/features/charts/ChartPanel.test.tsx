import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  type DataType,
  Float64,
  Int64,
  Table,
  TimestampMillisecond,
  Utf8,
  vectorFromArray,
} from "apache-arrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const store = vi.hoisted(() => ({
  result: null as unknown as { columns: { name: string; type: DataType }[]; rowCount: number },
  cells: [] as (string | null)[][],
}));
vi.mock("@/features/results/result-store", () => ({
  getResult: () => store.result,
  subscribeToResult: () => () => {},
  readCell: (row: number, column: number) => store.cells[row]?.[column] ?? null,
}));
function setResult(columns: { name: string; type: DataType }[], cells: (string | null)[][]) {
  store.result = { columns, rowCount: cells.length };
  store.cells = cells;
}
const draw = vi.hoisted(() => ({
  drawChart: vi.fn(() => () => {}),
  chartPng: vi.fn(
    (_container: HTMLElement, _theme?: "light" | "dark"): string | undefined => undefined,
  ),
}));
vi.mock("./draw-chart", () => draw);

const chartRows = new Table({
  x: vectorFromArray(["3", "5"], new Utf8()),
  y: vectorFromArray([4, 2], new Float64()),
});

describe("ChartPanel", () => {
  beforeEach(() => {
    setResult(
      [
        { name: "ts", type: new TimestampMillisecond() },
        { name: "weekday", type: new Utf8() },
        { name: "v", type: new Float64() },
      ],
      [
        ["2026-01-05 09:00", "Mon", "1.5"],
        ["2026-01-06 09:00", "Tue", "2"],
        ["2026-01-12 09:00", "Mon", "3"],
      ],
    );
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sums a number column when the result is already grouped by the chart's categories", async () => {
    setResult(
      [
        { name: "defect_type", type: new Utf8() },
        { name: "n", type: new Int64() },
      ],
      [
        ["Scratch", "685"],
        ["Dent", "154"],
        ["Crack", "61"],
      ],
    );
    engine.query.mockImplementation(async (sql: string) =>
      sql.includes('sum("n")')
        ? new Table({
            x: vectorFromArray(["Scratch", "Dent", "Crack"], new Utf8()),
            y: vectorFromArray([685, 154, 61], new Float64()),
          })
        : new Table({
            x: vectorFromArray(["Crack", "Dent", "Scratch"], new Utf8()),
            y: vectorFromArray([1, 1, 1], new Float64()),
          }),
    );
    const user = userEvent.setup();
    render(<ChartPanel />);
    expect(screen.getByLabelText("Aggregate")).toHaveValue("sum");
    expect(screen.getByLabelText("Y")).toHaveValue("n");

    await user.click(screen.getByRole("button", { name: "View as table" }));
    const table = await screen.findByRole("table", { name: "Bar chart of sum(n) by defect_type" });
    expect(within(table).getAllByRole("row")[1]?.textContent).toBe("Scratch685");
  });

  it("starts as a line chart over time when there's no text column for categories", async () => {
    setResult(
      [
        { name: "hour", type: new TimestampMillisecond() },
        { name: "good", type: new Int64() },
      ],
      [
        ["2026-01-05 09:00", "12"],
        ["2026-01-05 10:00", "7"],
      ],
    );
    engine.query.mockResolvedValue(chartRows);
    const user = userEvent.setup();
    render(<ChartPanel />);
    expect(screen.getByLabelText("Chart type")).toHaveValue("line");
    expect(screen.getByLabelText("X")).toHaveValue("hour");

    await user.selectOptions(screen.getByLabelText("Chart type"), "bar");
    expect(screen.getByLabelText("Chart type")).toHaveValue("bar");
  });

  it("counts rows in a result too long to check for repeated categories", () => {
    engine.query.mockResolvedValue(chartRows);
    setResult(
      [
        { name: "id", type: new Utf8() },
        { name: "v", type: new Float64() },
      ],
      Array.from({ length: 10_001 }, (_, row) => [`id-${row}`, "1"]),
    );
    render(<ChartPanel />);
    expect(screen.getByLabelText("Aggregate")).toHaveValue("count");
  });

  it("counts rows when the chart's categories repeat in the result", () => {
    engine.query.mockResolvedValue(chartRows);
    render(<ChartPanel />);
    expect(screen.getByLabelText("Aggregate")).toHaveValue("count");
    expect(screen.queryByLabelText("Y")).toBeNull();
  });

  it("keeps the aggregate picked for a result that's already grouped", async () => {
    setResult(
      [
        { name: "defect_type", type: new Utf8() },
        { name: "n", type: new Int64() },
      ],
      [
        ["Scratch", "685"],
        ["Dent", "154"],
      ],
    );
    engine.query.mockResolvedValue(chartRows);
    const user = userEvent.setup();
    render(<ChartPanel />);
    await user.selectOptions(screen.getByLabelText("Aggregate"), "count");
    expect(screen.getByLabelText("Aggregate")).toHaveValue("count");
    expect(screen.queryByLabelText("Y")).toBeNull();
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
    draw.chartPng.mockImplementation((_container, theme) => `data:image/png;base64,${theme}`);
    const user = userEvent.setup();
    const { unmount } = render(<ChartPanel />);
    await vi.waitFor(() => expect(draw.drawChart).toHaveBeenCalled());

    // In both themes, as the report shows the one for its reader's colours.
    expect(await getShownChartPicture()).toEqual({
      light: "data:image/png;base64,light",
      dark: "data:image/png;base64,dark",
      description: "Bar chart of count(*) by weekday, 2 bars, highest 4 (3), lowest 2 (5)",
    });

    await user.click(screen.getByRole("button", { name: "View as table" }));
    expect(await getShownChartPicture()).toBeNull();
    await user.click(screen.getByRole("button", { name: "View as table" }));

    unmount();
    expect(await getShownChartPicture()).toBeNull();
  });

  it("says in plain words why the chart's query failed", async () => {
    const message = `{"exception_type":"Catalog","exception_message":"Table with name readings does not exist!\\nDid you mean \\"reading\\"?","name":"readings","type":"Table","error_subtype":"MISSING_ENTRY","candidates":"reading"}`;
    engine.query.mockRejectedValue(new Error(message));
    render(<ChartPanel />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`There's no table called "readings"`);
    expect(alert).toHaveTextContent('Did you mean "reading"?');
    expect(alert).not.toHaveTextContent("exception_type");
  });
});
