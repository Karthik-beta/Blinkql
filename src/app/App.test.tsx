import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "@/engine/engine";
import { setChartPreset } from "@/features/charts/chart-preset";
import { withinSqlEditor } from "@/features/editor/test-utils";
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

  it("renders the workspace with the SQL editor", () => {
    render(<App />);

    const workspace = screen.getByRole("main", { name: "Workspace" });
    expect(workspace).toContainElement(document.querySelector("[data-sql-editor]"));
    expect(withinSqlEditor().getByRole("textbox", { name: "SQL editor" })).toBeInTheDocument();
  });

  it("marks the app shell for the benchmark harness", () => {
    render(<App />);

    expect(performance.getEntriesByName(marks.appShell, "mark")).toHaveLength(1);
  });

  it("starts the engine on load", () => {
    render(<App />);

    expect(engine.startEngine).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Starting engine…");
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

  it("switches the results to the chart when a template's chart preset arrives", () => {
    render(<App />);
    const chart = screen.getByRole("button", { name: "Chart" });
    expect(chart).toHaveAttribute("aria-pressed", "false");

    act(() => setChartPreset({ sql: "SELECT 1 AS x", type: "bar", x: "x" }));
    expect(chart).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Chart" })).toBeInTheDocument();
    act(() => setChartPreset(null));
  });
});
