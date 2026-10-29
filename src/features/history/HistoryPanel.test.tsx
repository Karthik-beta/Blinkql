import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEditorContents } from "@/features/editor/insert";
import type { QueryRun } from "@/features/results/query-run";
import { HistoryPanel } from "./HistoryPanel";
import { getHistory, resetHistory, saveQuery, startHistory } from "./history";
import { memoryStore } from "./storage";

const queryRun = vi.hoisted(() => {
  let run: QueryRun = { state: "idle" };
  const listeners = new Set<() => void>();
  return {
    runQuery: vi.fn(async (_sql: string, _editorOffset?: number) => {}),
    getQueryRun: () => run,
    subscribeToQueryRun: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRun(next: QueryRun) {
      run = next;
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("@/features/results/query-run", () => queryRun);

describe("HistoryPanel", () => {
  let editor = "";
  beforeEach(async () => {
    editor = "";
    setEditorContents({ get: () => editor, replace: (text) => (editor = text) });
    await startHistory(memoryStore());
  });
  afterEach(() => {
    act(() => resetHistory());
    setEditorContents(null);
    queryRun.setRun({ state: "idle" });
    vi.clearAllMocks();
  });

  function ran(sql: string, rowCount = 1) {
    act(() => queryRun.setRun({ state: "done", sql, rowCount, durationMs: 5 }));
  }

  it("lists past runs, newest first, and filters them", async () => {
    render(<HistoryPanel />);
    ran("SELECT * FROM orders", 40);
    ran("SELECT * FROM machines");
    act(() =>
      queryRun.setRun({
        state: "failed",
        sql: "SELEC 1",
        error: new Error("Parser Error: syntax error"),
        durationMs: 2,
        editorOffset: 0,
      }),
    );

    const list = screen.getByRole("list", { name: "Query history" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("code")?.textContent)).toEqual([
      "SELEC 1",
      "SELECT * FROM machines",
      "SELECT * FROM orders",
    ]);
    expect(items[0]).toHaveTextContent("Parser Error: syntax error");
    expect(items[2]).toHaveTextContent("40 rows");

    await userEvent.type(screen.getByRole("searchbox", { name: "Search history" }), "orders");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("runs a past query again from the editor, and copies it", async () => {
    const user = userEvent.setup();
    render(<HistoryPanel />);
    ran("SELECT 42");

    const item = within(screen.getByRole("list", { name: "Query history" })).getByRole("listitem");
    await user.click(within(item).getByRole("button", { name: "Run again" }));
    expect(editor).toBe("SELECT 42");
    expect(queryRun.runQuery).toHaveBeenCalledWith("SELECT 42", 0);

    await user.click(within(item).getByRole("button", { name: "Copy SQL" }));
    expect(await navigator.clipboard.readText()).toBe("SELECT 42");
    expect(screen.getByText("Copied to the clipboard.")).toBeInTheDocument();
  });

  it("describes each past run's buttons by its SQL, so they can be told apart", () => {
    render(<HistoryPanel />);
    ran("SELECT 1");
    ran("SELECT 2");

    const list = screen.getByRole("list", { name: "Query history" });
    const descriptions = within(list)
      .getAllByRole("button", { name: "Run again" })
      .map((button) => button.getAttribute("aria-describedby"))
      .map((id) => id && document.getElementById(id)?.textContent);
    expect(descriptions).toEqual(["SELECT 2", "SELECT 1"]);
    expect(
      within(list).getAllByRole("button", { name: "Copy SQL" })[0],
    ).toHaveAccessibleDescription("SELECT 2");
  });

  it("saves the editor's SQL under a name, then opens and runs it", async () => {
    const user = userEvent.setup();
    render(<HistoryPanel />);
    await user.click(screen.getByRole("button", { name: "Saved" }));
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-pressed", "true");

    editor = "SELECT * FROM orders WHERE late";
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Late orders{Enter}");
    const list = screen.getByRole("list", { name: "Saved queries" });
    expect(within(list).getByRole("listitem")).toHaveTextContent("Late orders");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");

    editor = "";
    await user.click(screen.getByRole("button", { name: "Open Late orders" }));
    expect(editor).toBe("SELECT * FROM orders WHERE late");
    await user.click(screen.getByRole("button", { name: "Run Late orders" }));
    expect(queryRun.runQuery).toHaveBeenCalledWith("SELECT * FROM orders WHERE late", 0);
  });

  it("renames and deletes a saved query", async () => {
    const user = userEvent.setup();
    await act(() => saveQuery("Late orders", "SELECT * FROM orders WHERE late"));
    render(<HistoryPanel />);
    await user.click(screen.getByRole("button", { name: "Saved" }));

    await user.click(screen.getByRole("button", { name: "Rename Late orders" }));
    const rename = screen.getByRole("textbox", { name: "New name for Late orders" });
    expect(rename).toHaveFocus();
    await user.clear(rename);
    await user.type(rename, "Overdue{Enter}");
    expect(getHistory().saved).toMatchObject([{ name: "Overdue" }]);
    expect(screen.getByRole("button", { name: "Rename Overdue" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Delete Overdue" }));
    expect(getHistory().saved).toEqual([]);
    expect(screen.getByText("No saved queries yet.")).toBeInTheDocument();
  });

  it("cancels a rename with Escape", async () => {
    const user = userEvent.setup();
    await act(() => saveQuery("One", "SELECT 1"));
    render(<HistoryPanel />);
    await user.click(screen.getByRole("button", { name: "Saved" }));

    await user.click(screen.getByRole("button", { name: "Rename One" }));
    await user.type(screen.getByRole("textbox", { name: "New name for One" }), "two{Escape}");
    expect(getHistory().saved).toMatchObject([{ name: "One" }]);
    expect(screen.getByRole("button", { name: "Rename One" })).toHaveFocus();
  });

  it("says when there's nothing in the editor to save", async () => {
    const user = userEvent.setup();
    render(<HistoryPanel />);
    await user.click(screen.getByRole("button", { name: "Saved" }));

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Empty{Enter}");
    expect(getHistory().saved).toEqual([]);
    expect(screen.getByText("Write some SQL to save first.")).toBeInTheDocument();
  });
});
