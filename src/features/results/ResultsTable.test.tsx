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
import { streamOf } from "./test-utils";

const engine = vi.hoisted(() => ({ streamQuery: vi.fn() }));
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
  if (result instanceof Error) engine.streamQuery.mockRejectedValueOnce(result);
  else engine.streamQuery.mockResolvedValueOnce(streamOf(result));
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

  it("renders for each result, not when the next query starts or while it runs", async () => {
    const onRender = vi.fn();
    render(
      <Profiler id="results" onRender={onRender}>
        <ResultsTable />
      </Profiler>,
    );
    await run(machines);
    onRender.mockClear();

    let finish!: (stream: ReturnType<typeof streamOf>) => void;
    engine.streamQuery.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    let next!: Promise<void>;
    act(() => {
      next = runQuery("SELECT 7 AS n");
    });
    // The previous result stays on screen, untouched.
    expect(onRender).not.toHaveBeenCalled();
    expect(screen.getAllByRole("row")).toHaveLength(4);

    await act(async () => {
      finish(streamOf(new Table({ n: vectorFromArray([7], new Int32()) })));
      await next;
    });
    // Once for its first rows, and once when it's complete.
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("columnheader", { name: "n" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("shows a result in one render, and renders once more when it's complete", async () => {
    const onRender = vi.fn();
    render(
      <Profiler id="results" onRender={onRender}>
        <ResultsTable />
      </Profiler>,
    );
    onRender.mockClear();
    await run(counting(1_000));

    expect(onRender).toHaveBeenCalledTimes(2);
  });

  it("shows the first rows before the rest arrive, and keeps the place as they do", async () => {
    render(<ResultsTable />);
    // Two batches of 2,000 rows, the second held back until the test lets it through.
    const rows = counting(4_000);
    const [first] = rows.slice(0, 2_000).batches;
    const [second] = rows.slice(2_000).batches;
    let more!: () => void;
    const arrived = new Promise<void>((resolve) => (more = resolve));
    async function* batches() {
      if (first) yield first;
      await arrived;
      if (second) yield second;
    }
    engine.streamQuery.mockResolvedValueOnce({ schema: rows.schema, batches: batches() });
    let done!: Promise<void>;
    await act(async () => {
      done = runQuery("SELECT * FROM numbers");
    });

    expect(grid()).toHaveAttribute("aria-rowcount", "2001");
    expect(cellTexts()[1]).toEqual(["0", "row 0"]);
    fireEvent.focus(grid());
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    const active = activeCell();
    expect(active).toMatchObject({ row: 3, column: 1 });

    await act(async () => {
      more();
      await done;
    });
    expect(grid()).toHaveAttribute("aria-rowcount", "4001");
    expect(activeCell()).toEqual(active);
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

  describe("selecting and copying", () => {
    const writeText = vi.fn<(text: string) => Promise<void>>();
    beforeEach(() => {
      writeText.mockResolvedValue();
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    });

    const selected = () =>
      within(grid())
        .queryAllByRole("gridcell", { selected: true })
        .map((cell) => cell.textContent);

    it("copies the active cell with Ctrl+C or ⌘C", async () => {
      render(<ResultsTable />);
      await run(machines);

      fireEvent.click(screen.getByRole("gridcell", { name: "lathe" }));
      fireEvent.keyDown(grid(), { key: "c", ctrlKey: true });
      expect(writeText).toHaveBeenLastCalledWith("lathe");
      fireEvent.keyDown(grid(), { key: "ArrowUp" });
      fireEvent.keyDown(grid(), { key: "c", metaKey: true });
      // NULL copies as an empty cell.
      expect(writeText).toHaveBeenLastCalledWith("");
    });

    it("selects a block with Shift and the arrow keys, and copies it as tab-separated text", async () => {
      render(<ResultsTable />);
      await run(machines);

      fireEvent.click(screen.getByRole("gridcell", { name: "1" }));
      fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
      fireEvent.keyDown(grid(), { key: "ArrowDown", shiftKey: true });
      fireEvent.keyDown(grid(), { key: "ArrowRight", shiftKey: true });
      expect(grid()).toHaveAttribute("aria-multiselectable", "true");
      expect(selected()).toEqual(["1", "press", "2", "NULL", "3", "lathe"]);
      expect(activeCell()).toEqual({ row: 4, column: 2, text: "lathe" });

      fireEvent.keyDown(grid(), { key: "c", ctrlKey: true });
      expect(writeText).toHaveBeenCalledWith("1\tpress\n2\t\n3\tlathe");

      // Moving without Shift leaves just the active cell selected.
      fireEvent.keyDown(grid(), { key: "ArrowUp" });
      expect(selected()).toEqual(["NULL"]);
    });

    it("selects a block with Shift+click, the header row included", async () => {
      render(<ResultsTable />);
      await run(machines);

      fireEvent.click(screen.getByRole("columnheader", { name: "machine" }));
      fireEvent.click(screen.getByRole("gridcell", { name: "2" }), { shiftKey: true });
      fireEvent.keyDown(grid(), { key: "c", ctrlKey: true });
      expect(writeText).toHaveBeenCalledWith("id\tmachine\n1\tpress\n2\t");
    });
  });

  describe("resizing columns", () => {
    /** The grid's column widths, which every row takes from its container. */
    const widths = () =>
      (grid().firstElementChild as HTMLElement).style.getPropertyValue("--columns");
    /** The edge of a column's header, dragged by mouse; the keyboard resizes with Alt+arrows. */
    const edge = (name: string) =>
      within(screen.getByRole("columnheader", { name })).getByTitle(
        "Drag to resize, double-click to fit",
      );

    it("widens and narrows the active cell's column with Alt and the arrow keys", async () => {
      render(<ResultsTable />);
      await run(machines);
      // The id column is fitted to its name.
      const id = "calc(2ch + 17px)";
      expect(widths()).toBe(`${id} calc(7ch + 17px)`);
      const header = screen.getByRole("columnheader", { name: "machine" });
      expect(header).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");
      expect(header).toHaveAccessibleDescription("Alt+Left and Alt+Right resize the column");

      fireEvent.click(screen.getByRole("columnheader", { name: "machine" }));
      // Every header is 800 px wide in jsdom.
      fireEvent.keyDown(grid(), { key: "ArrowRight", altKey: true });
      expect(widths()).toBe(`${id} 816px`);
      fireEvent.keyDown(grid(), { key: "ArrowLeft", altKey: true });
      expect(widths()).toBe(`${id} 784px`);
      // The active cell stays where it was.
      expect(activeCell()).toMatchObject({ row: 1, column: 2 });
    });

    it("resizes a column by dragging the edge of its header", async () => {
      render(<ResultsTable />);
      await run(machines);
      const id = "calc(2ch + 17px)";

      fireEvent.pointerDown(edge("machine"), { clientX: 100, button: 0 });
      fireEvent.pointerMove(window, { clientX: 150 });
      expect(widths()).toBe(`${id} 850px`);
      fireEvent.pointerUp(window, { clientX: 150 });
      fireEvent.pointerMove(window, { clientX: 300 });
      expect(widths()).toBe(`${id} 850px`);
    });

    it("fits a column to its content when the edge of its header is double-clicked", async () => {
      const long = "x".repeat(80);
      render(<ResultsTable />);
      await run(new Table({ note: vectorFromArray(["short", long], new Utf8()) }));
      // It starts at most 50 characters wide.
      expect(widths()).toBe("calc(50ch + 17px)");

      fireEvent.doubleClick(edge("note"));
      expect(widths()).toBe("calc(80ch + 17px)");
    });

    it("resizes without rendering the rows again", async () => {
      render(<ResultsTable />);
      await run(counting(1_000));
      fireEvent.focus(grid());
      vi.mocked(readCell).mockClear();

      fireEvent.keyDown(grid(), { key: "ArrowRight", altKey: true });
      fireEvent.pointerDown(edge("label"), { clientX: 100, button: 0 });
      fireEvent.pointerMove(window, { clientX: 120 });
      fireEvent.pointerUp(window);
      expect(readCell).not.toHaveBeenCalled();
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
