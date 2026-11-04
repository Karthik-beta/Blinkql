import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import type { Command } from "./command";

function setup(overrides: Partial<Record<string, Partial<Command>>> = {}) {
  const commands: Command[] = [
    { id: "run", label: "Run query", shortcut: "Ctrl+Enter", run: vi.fn() },
    { id: "chart", label: "Show chart", run: vi.fn() },
    { id: "table", label: "Show table", run: vi.fn() },
    { id: "csv", label: "Export as CSV", run: vi.fn(), disabled: true },
  ].map((command) => ({ ...command, ...overrides[command.id] }));
  const user = userEvent.setup();
  render(
    <>
      <button type="button">Elsewhere</button>
      <CommandPalette commands={commands} />
    </>,
  );
  const byId = (id: string) => commands.find((command) => command.id === id) as Command;
  return { user, byId };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}");
  return screen.findByRole("combobox", { name: "Search commands" });
}

const options = () => screen.getAllByRole("option").map((option) => option.textContent);
const active = () => {
  const id = screen.getByRole("combobox").getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
};

describe("CommandPalette", () => {
  it("opens with Ctrl+K and lists every command with its shortcut", async () => {
    const { user } = setup();
    const input = await open(user);

    expect(screen.getByRole("dialog", { name: "Commands" })).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(options()).toEqual(["Run queryCtrl+Enter", "Show chart", "Show table", "Export as CSV"]);
  });

  it("opens from its button, which shows the shortcut", async () => {
    const { user } = setup();
    const button = screen.getByRole("button", { name: "Commands" });
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+K");

    await user.click(button);
    expect(await screen.findByRole("combobox", { name: "Search commands" })).toHaveFocus();
  });

  it("filters by any part of the label, ignoring case", async () => {
    const { user } = setup();
    await user.type(await open(user), "SHOW");

    expect(options()).toEqual(["Show chart", "Show table"]);
    await user.type(screen.getByRole("combobox"), "x");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("No matching commands")).toBeInTheDocument();
  });

  it("moves through the list with the arrow keys, wrapping at the ends", async () => {
    const { user } = setup();
    await open(user);
    expect(active()).toHaveTextContent("Run query");
    expect(active()).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    expect(active()).toHaveTextContent("Show chart");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(active()).toHaveTextContent("Export as CSV");
    await user.keyboard("{ArrowDown}");
    expect(active()).toHaveTextContent("Run query");
  });

  it("runs the active command with Enter, closes and returns focus", async () => {
    const { user, byId } = setup();
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    await user.type(await open(user), "chart");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(byId("chart").run).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("runs a command that's clicked", async () => {
    const { user, byId } = setup();
    await open(user);
    await user.click(screen.getByRole("option", { name: "Show table" }));

    await waitFor(() => expect(byId("table").run).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows disabled commands but doesn't run them", async () => {
    const { user, byId } = setup();
    await user.type(await open(user), "csv");
    const option = screen.getByRole("option", { name: "Export as CSV" });
    expect(option).toHaveAttribute("aria-disabled", "true");

    await user.keyboard("{Enter}");
    await user.click(option);
    expect(byId("csv").run).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes with Escape without running anything", async () => {
    const { user, byId } = setup();
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    await open(user);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(byId("run").run).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("starts with an empty search each time it opens", async () => {
    const { user } = setup();
    await user.type(await open(user), "chart");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(await open(user)).toHaveValue("");
    expect(options()).toHaveLength(4);
  });

  it("ignores K pressed without Ctrl, or with other modifiers too", async () => {
    const { user } = setup();
    await user.keyboard("k{Shift>}{Control>}k{/Control}{/Shift}{Alt>}{Control>}k{/Control}{/Alt}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
