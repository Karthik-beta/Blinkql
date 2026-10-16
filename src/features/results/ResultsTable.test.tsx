import { act, render, screen, within } from "@testing-library/react";
import { Int32, Table, Utf8, vectorFromArray } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetQueryRun, runQuery } from "./query-run";
import { ResultsTable } from "./ResultsTable";

const engine = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/engine/engine", () => engine);

const machines = new Table({
  id: vectorFromArray([1, 2, 3], new Int32()),
  machine: vectorFromArray(["press", null, "lathe"], new Utf8()),
});

/** Runs a query whose result is `table`, or which fails. */
async function run(result: Table | Error) {
  if (result instanceof Error) engine.query.mockRejectedValueOnce(result);
  else engine.query.mockResolvedValueOnce(result);
  await act(() => runQuery("SELECT * FROM machines"));
}

describe("ResultsTable", () => {
  afterEach(() => {
    act(() => resetQueryRun());
    vi.clearAllMocks();
  });

  it("shows nothing before a query has run", () => {
    render(<ResultsTable />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows every row of the result under its column headers", async () => {
    render(<ResultsTable />);
    await run(machines);

    const table = within(screen.getByRole("region", { name: "Results" })).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["id", "machine"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["1", "press"],
      ["2", "NULL"],
      ["3", "lathe"],
    ]);
  });

  it("right-aligns numbers", async () => {
    render(<ResultsTable />);
    await run(machines);

    const [id, machine] = screen.getAllByRole("row")[1]?.children ?? [];
    expect(id).toHaveClass("text-right");
    expect(machine).toHaveClass("text-left");
  });

  it("shows the headers of an empty result", async () => {
    render(<ResultsTable />);
    await run(new Table({ id: vectorFromArray([], new Int32()) }));

    expect(screen.getByRole("columnheader", { name: "id" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("clears the previous result when a query fails", async () => {
    render(<ResultsTable />);
    await run(machines);
    await run(new Error("Catalog Error: Table with name machines does not exist!"));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
