import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "@/engine/engine";
import { setChartPreset } from "@/features/charts/chart-preset";
import { findSqlEditor } from "@/features/editor/test-utils";
import { marks } from "@/lib/user-timing";
import { App } from "./App";

// The real engine needs a Web Worker and WebAssembly; here it's a status the tests control.
const engine = vi.hoisted(() => {
  let status: EngineStatus = { state: "idle" };
  const listeners = new Set<() => void>();
  return {
    startEngine: vi.fn(),
    getEngineStatus: () => status,
    subscribeToEngineStatus: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setStatus(next: EngineStatus) {
      status = next;
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("@/engine/engine", () => engine);

describe("App shell", () => {
  beforeEach(() => {
    engine.setStatus({ state: "idle" });
    engine.startEngine.mockClear();
  });

  afterEach(() => {
    performance.clearMarks();
  });

  it("renders the top bar with the wordmark", () => {
    render(<App />);

    const banner = screen.getByRole("banner");
    expect(banner).toBeInTheDocument();
    // Light and dark wordmarks are both in the DOM; CSS shows the one for the active theme.
    expect(screen.getAllByRole("img", { name: "Blinkql" })).toHaveLength(2);
  });

  it("renders the workspace with the SQL editor", async () => {
    render(<App />);

    const editor = await findSqlEditor();
    const workspace = screen.getByRole("main", { name: "Workspace" });
    expect(workspace).toContainElement(document.querySelector("[data-sql-editor]"));
    expect(editor.getByRole("textbox", { name: "SQL editor" })).toBeInTheDocument();
  });

  it("marks the app shell for the benchmark harness", () => {
    render(<App />);

    expect(performance.getEntriesByName(marks.appShell, "mark")).toHaveLength(1);
  });

  it("starts the engine once the shell has been painted", async () => {
    render(<App />);

    expect(engine.startEngine).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Starting engine…");

    // Queued after the app's own frame callback, so it runs after the engine has been started.
    await act(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))));
    expect(engine.startEngine).toHaveBeenCalledOnce();
  });

  it("shows the DuckDB version once the engine is ready", () => {
    render(<App />);

    act(() => engine.setStatus({ state: "ready", version: "v1.4.1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Engine ready · DuckDB v1.4.1");
  });

  it("says why the engine failed to start", () => {
    render(<App />);

    act(() => engine.setStatus({ state: "failed", error: new Error("out of memory") }));
    expect(screen.getByRole("status")).toHaveTextContent("Engine failed to start: out of memory");
  });

  it("offers a restart when the engine failed to start or crashed", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "Restart engine" })).not.toBeInTheDocument();

    act(() => engine.setStatus({ state: "failed", error: new Error("out of memory") }));
    expect(screen.getByRole("button", { name: "Restart engine" })).toBeInTheDocument();

    act(() => engine.setStatus({ state: "crashed", error: new Error("worker died") }));
    expect(screen.getByRole("status")).toHaveTextContent("Engine stopped: worker died");
    expect(screen.getByRole("button", { name: "Restart engine" })).toBeInTheDocument();
  });

  it("switches the results to the chart when a template's chart preset arrives", async () => {
    render(<App />);
    const chart = screen.getByRole("button", { name: "Chart" });
    expect(chart).toHaveAttribute("aria-pressed", "false");

    act(() => setChartPreset({ sql: "SELECT 1 AS x", type: "bar", x: "x" }));
    expect(chart).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("region", { name: "Chart" })).toBeInTheDocument();
    act(() => setChartPreset(null));
  });

  it("reaches every core action from the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Commands" }));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Run queryCtrl+Enter",
      "Cancel queryEsc",
      "Show table",
      "Show chart",
      "Export as CSV",
      "Export as Parquet",
      "Share query",
      "Browse templates",
      "Import files",
      "Load sample data: Machine telemetry",
      "Load sample data: Breakdown log",
      "Load sample data: Shift output",
      "Load sample data: Attendance",
      "Load sample data: Quality checks",
      "Load sample data: ERP work orders",
      "Load sample data: MES work orders",
      "Load sample data: Item import",
      "Load sample data: Plants",
      "Restart engine",
      "Show keyboard shortcuts",
    ]);
    // Nothing is running and there's no result yet.
    const disabled = options.filter((option) => option.getAttribute("aria-disabled") === "true");
    expect(disabled.map((option) => option.textContent)).toEqual([
      "Cancel queryEsc",
      "Export as CSV",
      "Export as Parquet",
      "Share query",
    ]);
  });

  it("switches to the chart and back from the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);
    const chart = screen.getByRole("button", { name: "Chart" });

    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("show chart{Enter}");
    await waitFor(() => expect(chart).toHaveAttribute("aria-pressed", "true"));

    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("show table{Enter}");
    await waitFor(() => expect(chart).toHaveAttribute("aria-pressed", "false"));
  });

  it("opens the keyboard shortcuts from the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("shortcuts{Enter}");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});
