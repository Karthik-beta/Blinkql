import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChartPreset, setChartPreset } from "@/features/charts/chart-preset";
import { setEditorContents, setEditorFocuser } from "@/features/editor/insert";
import type { QueryRun } from "@/features/results/query-run";
import { Tour, TourInvite } from "./Tour";
import { endTour, getTourStep, startTour } from "./tour-step";

// The query run is a store the tests control; running a query only records it.
const queryRun = vi.hoisted(() => {
  let run: QueryRun = { state: "idle" };
  const listeners = new Set<() => void>();
  return {
    getQueryRun: () => run,
    subscribeToQueryRun: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    runQuery: vi.fn(async (_sql: string) => {}),
    setRun(next: QueryRun) {
      run = next;
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("@/features/results/query-run", () => queryRun);
const samples = vi.hoisted(() => ({ samples: [], loadSample: vi.fn(async (_name: string) => {}) }));
vi.mock("@/features/samples/samples", () => samples);

let editor = "";
const focusEditor = vi.fn();

function finishRun(sql: string) {
  act(() => queryRun.setRun({ state: "done", sql, rowCount: 8, durationMs: 5 }));
}

const panel = () => screen.getByRole("region", { name: "Tour" });

/** Opens the tour and goes through its first step. */
async function toRunStep() {
  const user = userEvent.setup();
  render(<Tour />);
  act(() => startTour());
  await user.click(screen.getByRole("button", { name: "Load quality checks" }));
  await screen.findByRole("button", { name: "Run the query" });
  return user;
}

describe("Tour", () => {
  beforeEach(() => {
    editor = "";
    setEditorContents({ get: () => editor, replace: (text) => (editor = text) });
    setEditorFocuser(focusEditor);
  });

  afterEach(() => {
    act(() => {
      endTour();
      queryRun.setRun({ state: "idle" });
      setChartPreset(null);
    });
    setEditorContents(null);
    setEditorFocuser(null);
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("opens on its first step with the focus on the step's action", () => {
    render(<Tour />);
    expect(screen.queryByRole("region", { name: "Tour" })).not.toBeInTheDocument();

    act(() => startTour());

    expect(panel()).toHaveTextContent("Step 1 of 3");
    expect(screen.getByRole("heading", { name: "Load sample data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load quality checks" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Skip tour" })).toBeInTheDocument();
  });

  it("announces each step politely", async () => {
    render(<Tour />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toBeEmptyDOMElement();

    act(() => startTour());
    expect(live).toHaveTextContent(/^Step 1 of 3: Load sample data\. /);

    await userEvent.click(screen.getByRole("button", { name: "Load quality checks" }));
    expect(await screen.findByText(/^Step 2 of 3: Run a query\. /)).toBe(live);
  });

  it("loads a sample, puts a query in the editor and moves on", async () => {
    await toRunStep();

    expect(samples.loadSample).toHaveBeenCalledWith("quality_checks");
    expect(editor).toMatch(/FROM quality_checks/);
    expect(panel()).toHaveTextContent("Step 2 of 3");
    expect(screen.getByRole("button", { name: "Run the query" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "End tour" })).toBeInTheDocument();
  });

  it("shows why a sample didn't load and lets the user try again", async () => {
    const user = userEvent.setup();
    samples.loadSample.mockRejectedValueOnce(new Error("Engine failed to start"));
    render(<Tour />);
    act(() => startTour());

    await user.click(screen.getByRole("button", { name: "Load quality checks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the sample: Engine failed to start",
    );
    expect(getTourStep()).toBe("load");

    await user.click(screen.getByRole("button", { name: "Load quality checks" }));
    expect(await screen.findByRole("button", { name: "Run the query" })).toBeInTheDocument();
  });

  it("runs the query in the editor and moves on when it finishes", async () => {
    const user = await toRunStep();
    editor = "SELECT machine_id FROM quality_checks";

    await user.click(screen.getByRole("button", { name: "Run the query" }));
    expect(queryRun.runQuery).toHaveBeenCalledWith("SELECT machine_id FROM quality_checks");

    act(() => queryRun.setRun({ state: "running", sql: editor, startedAt: 0 }));
    expect(screen.getByRole("button", { name: "Running…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(getTourStep()).toBe("run");

    finishRun(editor);
    expect(panel()).toHaveTextContent("Step 3 of 3");
    expect(screen.getByRole("button", { name: "Show as a chart" })).toHaveFocus();
  });

  it("moves on when the user runs the query themselves", async () => {
    await toRunStep();

    finishRun(editor);
    expect(getTourStep()).toBe("chart");
  });

  it("says so when the query fails", async () => {
    await toRunStep();

    act(() =>
      queryRun.setRun({
        state: "failed",
        sql: editor,
        error: new Error("Parser Error"),
        durationMs: 1,
        editorOffset: 0,
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/didn't run/);
    expect(getTourStep()).toBe("run");
  });

  it("charts the result, then points at the chart's settings and ends with Done", async () => {
    const user = await toRunStep();
    finishRun(editor);

    await user.click(screen.getByRole("button", { name: "Show as a chart" }));
    expect(getChartPreset()).toEqual({
      sql: editor,
      type: "bar",
      x: "machine_id",
      y: "reject_rate_pct",
      aggregate: "avg",
    });
    expect(panel()).toHaveTextContent(/chart settings/);
    expect(screen.queryByRole("button", { name: "End tour" })).not.toBeInTheDocument();

    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toHaveFocus();
    await user.click(done);
    expect(screen.queryByRole("region", { name: "Tour" })).not.toBeInTheDocument();
    expect(focusEditor).toHaveBeenCalled();
  });

  it("ends when skipped", async () => {
    render(<Tour />);
    act(() => startTour());

    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("region", { name: "Tour" })).not.toBeInTheDocument();
    expect(getTourStep()).toBeNull();
    expect(focusEditor).toHaveBeenCalled();
  });

  it("ends on Escape", async () => {
    const user = await toRunStep();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Tour" })).not.toBeInTheDocument();
    expect(focusEditor).toHaveBeenCalled();
  });
});

describe("TourInvite", () => {
  afterEach(() => {
    act(() => {
      endTour();
      queryRun.setRun({ state: "idle" });
    });
    localStorage.clear();
  });

  it("offers the tour before any query has run", async () => {
    render(<TourInvite />);

    await userEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(getTourStep()).toBe("load");
    // Not while the tour is open.
    expect(screen.queryByRole("button", { name: "Take the tour" })).not.toBeInTheDocument();
  });

  it("isn't offered once a query has run", () => {
    render(<TourInvite />);

    act(() => queryRun.setRun({ state: "running", sql: "SELECT 1", startedAt: 0 }));
    expect(screen.queryByRole("button", { name: "Take the tour" })).not.toBeInTheDocument();
  });

  it("isn't offered again once the tour has ended, though it can still start", () => {
    render(<TourInvite />);
    act(() => {
      startTour();
      endTour();
    });
    expect(screen.queryByRole("button", { name: "Take the tour" })).not.toBeInTheDocument();

    act(() => startTour());
    expect(getTourStep()).toBe("load");
  });
});
