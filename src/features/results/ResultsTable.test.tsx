import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Int32, Table, Utf8, vectorFromArray } from "apache-arrow";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetQueryRun, runQuery } from "./query-run";
import {
  MAX_SCROLL_HEIGHT,
  ResultsTable,
  ROW_HEIGHT,
  revealRow,
  scrollScale,
} from "./ResultsTable";
import { readCell } from "./result-store";

const engine = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/engine/engine", () => engine);

// The real store, with cell reads counted.
vi.mock("./result-store", async (importOriginal) => {
  const store = await importOriginal<typeof import("./result-store")>();
  return { ...store, readCell: vi.fn(store.readCell) };
});

/** The grid's viewport: the header and 9 rows. jsdom has no layout, so it's given. */
const VIEWPORT = { width: 800, height: 10 * ROW_HEIGHT };

const machines = new Table({
  id: vectorFromArray([1, 2, 3], new Int32()),
  machine: vectorFromArray(["press", null, "lathe"], new Utf8()),
});

/** `rows` rows of two columns: n, from 0, and its label. */
function counting(rows: number): Table {
  const n = Array.from({ length: rows }, (_, i) => i);
  return new Table({
    n: vectorFromArray(n, new Int32()),
    label: vectorFromArray(
      n.map((i) => `row ${i}`),
      new Utf8(),
    ),
  });
}

/** Runs a query whose result is `table`, or which fails. */
async function run(result: Table | Error) {
  if (result instanceof Error) engine.query.mockRejectedValueOnce(result);
  else engine.query.mockResolvedValueOnce(result);
  await act(() => runQuery("SELECT * FROM machines"));
}

const grid = () => screen.getByRole("grid", { name: "Results" });

/** The text of each cell, row by row, the header row included. */
const cellTexts = () =>
  within(grid())
    .getAllByRole("row")
    .map((row) =>
      [...row.querySelectorAll('[role="gridcell"], [role="columnheader"]')].map(
        (cell) => cell.textContent,
      ),
    );

/** The active cell's row (1 is the header) and column, as screen readers announce them. */
function activeCell(): { row: number; column: number; text: string | null } | null {
  const id = grid().getAttribute("aria-activedescendant");
  const cell = id ? document.getElementById(id) : null;
  if (!cell) return null;
  return {
    row: Number(cell.closest('[role="row"]')?.getAttribute("aria-rowindex")),
    column: Number(cell.getAttribute("aria-colindex")),
    text: cell.textContent,
  };
}

describe("ResultsTable", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(VIEWPORT.width);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(VIEWPORT.height);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(VIEWPORT.height);
  });

  afterEach(() => {
    act(() => resetQueryRun());
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("shows nothing before a query has run", () => {
    render(<ResultsTable />);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("shows the rows of the result under their column headers", async () => {
    render(<ResultsTable />);
    await run(machines);

    expect(cellTexts()).toEqual([
      ["id", "machine"],
      ["1", "press"],
      ["2", "NULL"],
      ["3", "lathe"],
    ]);
    expect(grid()).toHaveAttribute("aria-rowcount", "4");
    expect(grid()).toHaveAttribute("aria-colcount", "2");
  });

  it("right-aligns numbers", async () => {
    render(<ResultsTable />);
    await run(machines);

    const [id, machine] = within(grid()).getAllByRole("gridcell");
    expect(id).toHaveClass("text-right");
    expect(machine).toHaveClass("text-left");
  });

  it("shows the headers of an empty result", async () => {
    render(<ResultsTable />);
    await run(new Table({ id: vectorFromArray([], new Int32()) }));

    expect(screen.getByRole("columnheader", { name: "id" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("renders only the rows in view and a few either side, numbered within the whole result", async () => {
    render(<ResultsTable />);
    await run(counting(100_000));

    const rows = within(grid()).getAllByRole("row");
    // The header, 9 rows in view and 10 more below.
    expect(rows).toHaveLength(20);
    expect(rows.at(-1)).toHaveAttribute("aria-rowindex", "20");
    expect(grid()).toHaveAttribute("aria-rowcount", "100001");
    // Only the rows in the page are read from the result.
    expect(readCell).toHaveBeenCalledWith(18, 1);
    expect(readCell).not.toHaveBeenCalledWith(500, 0);
  });

  it("renders once per result, not when the next query starts or while it runs", async () => {
    const onRender = vi.fn();
    render(
      <Profiler id="results" onRender={onRender}>
        <ResultsTable />
      </Profiler>,
    );
    await run(machines);
    onRender.mockClear();

    let finish!: (table: Table) => void;
    engine.query.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    let next!: Promise<void>;
    act(() => {
      next = runQuery("SELECT 7 AS n");
    });
    // The previous result stays on screen, untouched.
    expect(onRender).not.toHaveBeenCalled();
    expect(screen.getAllByRole("row")).toHaveLength(4);

    await act(async () => {
      finish(new Table({ n: vectorFromArray([7], new Int32()) }));
      await next;
    });
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("columnheader", { name: "n" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("shows the first result in one render", async () => {
    const onRender = vi.fn();
    render(
      <Profiler id="results" onRender={onRender}>
        <ResultsTable />
      </Profiler>,
    );
    onRender.mockClear();
    await run(counting(1_000));

    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("doesn't read the cells again when its parent renders", async () => {
    const { rerender } = render(<ResultsTable />);
    await run(machines);
    vi.mocked(readCell).mockClear();

    rerender(<ResultsTable />);
    expect(readCell).not.toHaveBeenCalled();
  });

  it("clears the previous result when a query fails", async () => {
    render(<ResultsTable />);
    await run(machines);
    await run(new Error("Catalog Error: Table with name machines does not exist!"));

    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  describe("keyboard", () => {
    it("starts on the first cell and moves with the arrow keys, Home and End", async () => {
      render(<ResultsTable />);
      await run(counting(1_000));
      act(() => grid().focus());
      expect(activeCell()).toEqual({ row: 2, column: 1, text: "0" });

      const steps: [string, { ctrlKey?: boolean }?][] = [
        ["ArrowRight"],
        ["ArrowRight"], // already in the last column
        ["ArrowDown"],
        ["Home"],
        ["End"],
        ["ArrowUp"],
        ["ArrowUp"], // onto the header
        ["ArrowUp"], // already on the header
        ["ArrowLeft"],
      ];
      const visited = steps.map(([key, modifiers]) => {
        fireEvent.keyDown(grid(), { key, ...modifiers });
        return activeCell();
      });
      expect(visited).toEqual([
        { row: 2, column: 2, text: "row 0" },
        { row: 2, column: 2, text: "row 0" },
        { row: 3, column: 2, text: "row 1" },
        { row: 3, column: 1, text: "1" },
        { row: 3, column: 2, text: "row 1" },
        { row: 2, column: 2, text: "row 0" },
        { row: 1, column: 2, text: "label" },
        { row: 1, column: 2, text: "label" },
        { row: 1, column: 1, text: "n" },
      ]);
    });

    it("moves a screenful with Page Up and Page Down, and to the ends with Ctrl+Home and Ctrl+End", async () => {
      render(<ResultsTable />);
      await run(counting(1_000));
      act(() => grid().focus());

      fireEvent.keyDown(grid(), { key: "PageDown" });
      // 9 rows fit under the header.
      expect(activeCell()).toEqual({ row: 11, column: 1, text: "9" });
      fireEvent.keyDown(grid(), { key: "End", ctrlKey: true });
      // The last row is out of the page until the grid scrolls to it, which jsdom can't do.
      expect(activeCell()).toBeNull();
      fireEvent.keyDown(grid(), { key: "Home", ctrlKey: true });
      expect(activeCell()).toEqual({ row: 2, column: 1, text: "0" });
      fireEvent.keyDown(grid(), { key: "PageUp" });
      // Page Up stops at the first row; the header is one Arrow Up away.
      expect(activeCell()).toEqual({ row: 2, column: 1, text: "0" });
    });

    it("makes a clicked cell the active one", async () => {
      render(<ResultsTable />);
      await run(machines);

      fireEvent.click(screen.getByRole("gridcell", { name: "lathe" }));
      expect(activeCell()).toEqual({ row: 4, column: 2, text: "lathe" });
    });

    it("starts a new result without an active cell", async () => {
      render(<ResultsTable />);
      await run(machines);
      fireEvent.click(screen.getByRole("gridcell", { name: "lathe" }));
      await run(counting(5));

      expect(grid()).not.toHaveAttribute("aria-activedescendant");
    });
  });
});

describe("scrolling a result taller than the scrolling area can be", () => {
  const viewport = 400;
  const fakeGrid = (scrollTop = 0) => ({ clientHeight: viewport, scrollTop }) as HTMLElement;

  it("moves the rows a pixel per pixel scrolled while they fit", () => {
    const rows = Math.floor(MAX_SCROLL_HEIGHT / ROW_HEIGHT);
    expect(scrollScale(fakeGrid(), rows)).toBe(1);
  });

  it("moves them further per pixel when they don't, so the end of the area shows the last row", () => {
    const rows = 1_000_000;
    const scale = scrollScale(fakeGrid(), rows);
    expect(scale).toBeGreaterThan(1);
    // Scrolled to the end, the rows are scrolled to theirs.
    const end = ROW_HEIGHT + MAX_SCROLL_HEIGHT - viewport;
    expect(end * scale).toBeCloseTo(ROW_HEIGHT + rows * ROW_HEIGHT - viewport);
  });

  it("scrolls a row into view below the header, from above or below", () => {
    const rows = 1_000_000;
    const scale = scrollScale(fakeGrid(), rows);
    const below = viewport - ROW_HEIGHT;
    for (const [from, row] of [
      [0, 500_000],
      [MAX_SCROLL_HEIGHT, 500_000],
      [0, rows - 1],
    ] as const) {
      const grid = fakeGrid(from);
      revealRow(grid, row, rows);
      const offset = grid.scrollTop * scale;
      expect(row * ROW_HEIGHT).toBeGreaterThanOrEqual(offset);
      expect((row + 1) * ROW_HEIGHT).toBeLessThanOrEqual(offset + below);
    }
  });

  it("leaves the scroll alone when the row is already in view", () => {
    const grid = fakeGrid(240);
    revealRow(grid, 12, 1_000);
    expect(grid.scrollTop).toBe(240);
  });
});
