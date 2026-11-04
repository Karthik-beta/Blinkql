import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStatus } from "@/engine/engine";
import { setChartPreset } from "@/features/charts/chart-preset";
import { findSqlEditor } from "@/features/editor/test-utils";
import { resetQueryRun, runQuery } from "@/features/results/query-run";
import { endTour } from "@/features/tour/tour-step";
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

  it("starts with a link that skips to the workspace without changing the URL", () => {
    render(<App />);

    const skip = screen.getByRole("link", { name: "Skip to the workspace" });
    skip.focus();
    act(() => skip.click());
    expect(screen.getByRole("main", { name: "Workspace" })).toHaveFocus();
    expect(location.hash).toBe("");
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
      "Export as HTML report",
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
      "Load sample data: Shipments",
      "Take the tour",
      "Restart engine",
      "Show keyboard shortcuts",
    ]);
    // Nothing is running and there's no result yet.
    const disabled = options.filter((option) => option.getAttribute("aria-disabled") === "true");
    expect(disabled.map((option) => option.textContent)).toEqual([
      "Cancel queryEsc",
      "Export as CSV",
      "Export as Parquet",
      "Export as HTML report",
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

  it("starts the tour from the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("take the tour{Enter}");
    expect(await screen.findByRole("region", { name: "Tour" })).toBeInTheDocument();
    act(() => endTour());
  });

  it("opens the keyboard shortcuts from the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("shortcuts{Enter}");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  describe("on a screen too narrow for the sidebar", () => {
    const screenWidth = { narrow: true, listeners: new Set<() => void>() };

    /** Turns the screen, as a tablet does when rotated, and tells the media query listeners. */
    const turnScreen = (narrow: boolean) =>
      act(() => {
        screenWidth.narrow = narrow;
        for (const listener of screenWidth.listeners) listener();
      });

    beforeEach(() => {
      screenWidth.narrow = true;
      vi.stubGlobal("matchMedia", (media: string) => {
        // Other queries, such as the editor's for printing, never change here.
        const isWidth = media === "(width < 64rem)";
        return {
          get matches() {
            return isWidth && screenWidth.narrow;
          },
          media,
          addEventListener: (_type: string, listener: () => void) =>
            isWidth && screenWidth.listeners.add(listener),
          removeEventListener: (_type: string, listener: () => void) =>
            screenWidth.listeners.delete(listener),
        };
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      resetQueryRun();
    });

    it("keeps the sidebar in a sheet that the Tables button opens and Close closes", async () => {
      const user = userEvent.setup();
      render(<App />);
      const open = screen.getByRole("button", { name: "Tables" });
      expect(screen.queryByRole("complementary", { name: "Tables" })).not.toBeInTheDocument();

      await user.click(open);
      const sheet = await screen.findByRole("dialog", { name: "Tables and queries" });
      expect(within(sheet).getByRole("complementary", { name: "Tables" })).toBeInTheDocument();
      expect(within(sheet).getByRole("region", { name: "Queries" })).toBeInTheDocument();

      await user.click(within(sheet).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(open).toHaveFocus();
    });

    it("gives the focus back to Tables on closing, even if tapping it didn't focus it", async () => {
      const user = userEvent.setup();
      render(<App />);
      const open = screen.getByRole("button", { name: "Tables" });

      // Safari doesn't focus a button that's clicked or tapped, so focus stays on the page.
      fireEvent.click(open);
      const sheet = await screen.findByRole("dialog", { name: "Tables and queries" });
      await user.click(within(sheet).getByRole("button", { name: "Close" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(open).toHaveFocus();
    });

    it("doesn't reopen the sheet when the screen turns wide and back", async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole("button", { name: "Tables" }));
      await screen.findByRole("dialog", { name: "Tables and queries" });

      turnScreen(false);
      expect(screen.getByRole("complementary", { name: "Tables" })).toBeInTheDocument();
      // The focus was in the sheet; it stays in the app rather than falling to the page.
      await waitFor(() => expect(screen.getByRole("main", { name: "Workspace" })).toHaveFocus());
      turnScreen(true);

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Tables" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    it("keeps the focus in the app when the screen turns wide and Tables goes", () => {
      render(<App />);
      screen.getByRole("button", { name: "Tables" }).focus();

      turnScreen(false);

      expect(screen.getByRole("main", { name: "Workspace" })).toHaveFocus();
    });

    it("leaves the focus alone when the screen turns wide with nothing focused", () => {
      render(<App />);

      turnScreen(false);

      expect(document.body).toHaveFocus();
    });

    it("closes the sheet when a query starts", async () => {
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole("button", { name: "Tables" }));
      await screen.findByRole("dialog", { name: "Tables and queries" });

      act(() => void runQuery("SELECT 1"));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });
  });
});
