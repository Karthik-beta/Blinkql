import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorPanel } from "./ErrorPanel";
import type { EngineError } from "./engine-error";

const missingTable: EngineError = {
  type: "Catalog",
  subtype: "MISSING_ENTRY",
  message: 'Table with name machnes does not exist!\nDid you mean "machines"?',
  position: 17,
  name: "machnes",
  entryType: "Table",
  candidates: ["machines"],
  crashed: false,
};
const sql = "SELECT *\nFROM t, machnes";

describe("ErrorPanel", () => {
  it("says what went wrong, what kind of error it is and what to try", () => {
    render(<ErrorPanel error={missingTable} sql={sql} />);

    const panel = screen.getByRole("alert", { name: 'There\'s no table called "machnes"' });
    expect(panel).toHaveTextContent("Catalog error");
    expect(panel).toHaveTextContent('Did you mean "machines"?');
  });

  it("shows the line with the error and a caret under it", () => {
    render(<ErrorPanel error={missingTable} sql={sql} />);

    expect(screen.getByText("Line 2")).toBeInTheDocument();
    expect(screen.getByText(/^FROM t, machnes/, { selector: "figure pre" }).textContent).toBe(
      "FROM t, machnes\n        ^",
    );
  });

  it("shortens long lines around the error", () => {
    const long = `SELECT ${"a, ".repeat(100)}machnes`;
    render(<ErrorPanel error={{ ...missingTable, position: 307 }} sql={long} />);

    const [line, caret] =
      screen.getByText(/machnes/, { selector: "figure pre" }).textContent?.split("\n") ?? [];
    expect(line?.startsWith("…")).toBe(true);
    expect(line?.[caret?.indexOf("^") ?? -1]).toBe("m");
  });

  it("keeps DuckDB's own message, folded away", () => {
    render(<ErrorPanel error={missingTable} sql={sql} />);

    expect(screen.getByText("DuckDB's message")).toBeInTheDocument();
    expect(screen.getByText(/Did you mean "machines"\?$/, { selector: "pre" })).not.toBeVisible();
  });

  it("goes to the error when asked", async () => {
    const onGoTo = vi.fn();
    render(<ErrorPanel error={missingTable} sql={sql} onGoTo={onGoTo} />);

    await userEvent.click(screen.getByRole("button", { name: "Go to error" }));
    expect(onGoTo).toHaveBeenCalled();
  });

  it("offers a restart after a crash, and only then", async () => {
    const onRestart = vi.fn();
    const { rerender } = render(
      <ErrorPanel error={missingTable} sql={sql} onRestart={onRestart} />,
    );
    expect(screen.queryByRole("button", { name: "Restart engine" })).not.toBeInTheDocument();

    const crash: EngineError = {
      type: "Engine",
      message: "unreachable",
      candidates: [],
      crashed: true,
    };
    rerender(<ErrorPanel error={crash} sql={sql} onRestart={onRestart} />);
    expect(screen.getByRole("alert", { name: "The engine stopped" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restart engine" }));
    expect(onRestart).toHaveBeenCalled();
  });
});
