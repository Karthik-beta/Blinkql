import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tableFromArrays } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetQueryRun, runQuery } from "@/features/results/query-run";
import { streamOf } from "@/features/results/test-utils";
import { editorContents, insertIntoEditor, replaceEditorContents } from "./insert";
import { QueryPanel } from "./QueryPanel";
import { findSqlEditor } from "./test-utils";

// Each query waits until the test settles it.
const engine = vi.hoisted(() => {
  let settle: { resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null;
  return {
    streamQuery: vi.fn(
      (_sql: string, signal?: AbortSignal) =>
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
          signal?.addEventListener("abort", () => reject(new Error("query was canceled")));
        }),
    ),
    finish: (value: unknown) => settle?.resolve(value),
    fail: (error: Error) => settle?.reject(error),
  };
});
vi.mock("@/engine/engine", () => engine);

describe("QueryPanel", () => {
  afterEach(() => {
    act(() => resetQueryRun());
    vi.clearAllMocks();
    // Text sent without an editor waits for the next one, so it mustn't reach the next test's.
    cleanup();
    replaceEditorContents("");
  });

  it("shows a labelled SQL editor and a Run button with its shortcut", async () => {
    render(<QueryPanel />);

    expect((await findSqlEditor()).getByRole("textbox", { name: "SQL editor" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+Enter",
    );
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+Enter",
    );
    expect(screen.getByText("Press Ctrl+Enter to run the query.")).toBeInTheDocument();
  });

  it("doesn't run an empty editor", async () => {
    render(<QueryPanel />);
    await findSqlEditor();

    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(engine.streamQuery).not.toHaveBeenCalled();
  });

  it("runs names inserted from elsewhere, such as the schema browser", async () => {
    const { unmount } = render(<QueryPanel />);
    await findSqlEditor();

    act(() => insertIntoEditor("SELECT * FROM "));
    act(() => insertIntoEditor("orders"));
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(engine.streamQuery).toHaveBeenCalledWith("SELECT * FROM orders", expect.anything());

    unmount();
    expect(() => insertIntoEditor("SELECT 3")).not.toThrow();
  });

  it("lets other parts read and replace the whole editor, such as the query history", async () => {
    const { unmount } = render(<QueryPanel />);
    await findSqlEditor();

    act(() => insertIntoEditor("SELECT 1"));
    expect(editorContents()).toBe("SELECT 1");
    act(() => replaceEditorContents("SELECT 2"));
    expect(editorContents()).toBe("SELECT 2");
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(engine.streamQuery).toHaveBeenCalledWith("SELECT 2", expect.anything());

    unmount();
    expect(editorContents()).toBe("");
    expect(() => replaceEditorContents("SELECT 3")).not.toThrow();
  });

  it("keeps what other parts send before the editor has loaded, and starts with it", async () => {
    act(() => replaceEditorContents("SELECT 1"));
    act(() => insertIntoEditor(" + 1"));
    expect(editorContents()).toBe("SELECT 1 + 1");

    render(<QueryPanel />);
    await findSqlEditor();
    expect(editorContents()).toBe("SELECT 1 + 1");
    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(engine.streamQuery).toHaveBeenCalledWith("SELECT 1 + 1", expect.anything());
  });

  it("turns Run into a running state with a timer, then reports the result", async () => {
    render(<QueryPanel />);
    await findSqlEditor();

    let running!: Promise<void>;
    act(() => {
      running = runQuery("SELECT * FROM range(40)");
    });
    const button = screen.getByRole("button", { name: /^Running \d+ ms$/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Running…")).toBeInTheDocument();

    await act(async () => {
      engine.finish(streamOf(tableFromArrays({ n: Int32Array.from({ length: 40 }, (_, i) => i) })));
      await running;
    });
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText(/^40 rows in \d+ ms$/)).toBeInTheDocument();
  });

  it("offers Cancel only while a query runs, and cancels it", async () => {
    render(<QueryPanel />);
    await findSqlEditor();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    let running!: Promise<void>;
    act(() => {
      running = runQuery("SELECT * FROM range(40)");
    });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("aria-keyshortcuts", "Escape");

    await userEvent.click(cancel);
    await act(() => running);
    expect(screen.getByText(/^Cancelled after \d+ ms$/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("cancels the running query on Escape", async () => {
    render(<QueryPanel />);
    await findSqlEditor();

    let running!: Promise<void>;
    act(() => {
      running = runQuery("SELECT * FROM range(40)");
    });
    await userEvent.keyboard("{Escape}");
    await act(() => running);
    expect(screen.getByText(/^Cancelled after \d+ ms$/)).toBeInTheDocument();
  });

  it("says when a query failed, and why", async () => {
    render(<QueryPanel />);
    await findSqlEditor();

    await act(async () => {
      const running = runQuery("SELEC 1");
      engine.fail(
        new Error(
          'Parser Error: {"exception_type":"Parser","exception_message":"syntax error at or near \\"SELEC\\"","error_subtype":"SYNTAX_ERROR","position":"0"}',
        ),
      );
      await running;
    });
    expect(screen.getByRole("alert")).toHaveTextContent('Syntax error near "SELEC"');
    expect(screen.getByText(/^Failed after \d+ ms$/)).toBeInTheDocument();
  });
});
