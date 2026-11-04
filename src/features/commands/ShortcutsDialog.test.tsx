import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShortcutsDialog } from "./ShortcutsDialog";

describe("ShortcutsDialog", () => {
  it("lists the shortcuts by where they work", () => {
    render(<ShortcutsDialog open onOpenChange={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const tables = within(dialog).getAllByRole("table");
    expect(tables.map((table) => table.querySelector("caption")?.textContent)).toEqual([
      "Anywhere",
      "SQL editor",
      "Tables list",
      "Results table",
    ]);
    const row = (name: string) => within(dialog).getByRole("row", { name: new RegExp(`^${name}`) });
    expect(row("Open the command palette")).toHaveTextContent("Ctrl+K");
    expect(row("Run the query, or the selected part")).toHaveTextContent("Ctrl+Enter");
    expect(row("Close a dialog")).toHaveTextContent("Esc");
    expect(row("Undo")).toHaveTextContent("Ctrl+Z");
  });
});
