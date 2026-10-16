import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetQueryRun, runQuery } from "@/features/results/query-run";
import { QueryPanel } from "./QueryPanel";
import { withinSqlEditor } from "./test-utils";

// Each query waits until the test settles it.
const engine = vi.hoisted(() => {
  let settle: { resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null;
  return {
    query: vi.fn(
      (_sql: string) =>
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
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
  });

  it("shows a labelled SQL editor and a Run button with its shortcut", () => {
    render(<QueryPanel />);

    expect(withinSqlEditor().getByRole("textbox", { name: "SQL editor" })).toHaveAttribute(
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

    await userEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(engine.query).not.toHaveBeenCalled();
  });

  it("turns Run into a running state with a timer, then reports the result", async () => {
    render(<QueryPanel />);

    let running!: Promise<void>;
    act(() => {
      running = runQuery("SELECT * FROM range(40)");
    });
    const button = screen.getByRole("button", { name: /^Running \d+ ms$/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Running…")).toBeInTheDocument();

    await act(async () => {
      engine.finish({ numRows: 40 });
      await running;
    });
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText(/^40 rows in \d+ ms$/)).toBeInTheDocument();
  });

  it("says when a query failed, and why", async () => {
    render(<QueryPanel />);

    await act(async () => {
      const running = runQuery("SELEC 1");
      engine.fail(new Error("Parser Error: syntax error at or near SELEC"));
      await running;
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Query failed: Parser Error: syntax error at or near SELEC",
    );
  });
});
