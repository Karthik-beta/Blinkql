import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "@/features/catalog/catalog";
import { getChartPreset, setChartPreset } from "@/features/charts/chart-preset";
import { setEditorContents } from "@/features/editor/insert";
import { TemplatesDialog, type TemplatesHandle } from "./TemplatesDialog";

// The catalog holds whatever tables a test gives it; loading the sample adds quality_checks.
const catalog = vi.hoisted(() => {
  let current = { tables: [] } as unknown as Catalog;
  const listeners = new Set<() => void>();
  return {
    getCatalog: () => current,
    subscribeToCatalog: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTables(tables: { name: string; columns: { name: string; type: string }[] }[]) {
      current = { tables } as unknown as Catalog;
      for (const listener of listeners) listener();
    },
  };
});
vi.mock("@/features/catalog/catalog", () => catalog);
const queryRun = vi.hoisted(() => ({ runQuery: vi.fn(async (_sql: string) => {}) }));
vi.mock("@/features/results/query-run", () => queryRun);
const samples = vi.hoisted(() => ({ samples: [], loadSample: vi.fn(async (_name: string) => {}) }));
vi.mock("@/features/samples/samples", () => samples);

const sampleTable = {
  name: "quality_checks",
  columns: [
    { name: "check_id", type: "INTEGER" },
    { name: "machine_id", type: "VARCHAR" },
    { name: "checked_at", type: "TIMESTAMP" },
    { name: "inspected", type: "INTEGER" },
    { name: "rejected", type: "INTEGER" },
    { name: "defect_type", type: "VARCHAR" },
  ],
};

// A user's file with the same data under other names, and a rejected count that's text.
const userTable = {
  name: "line_qc",
  columns: [
    { name: "Asset", type: "VARCHAR" },
    { name: "Qty", type: "BIGINT" },
    { name: "Scrap", type: "VARCHAR" },
  ],
};

async function openTemplate() {
  const user = userEvent.setup();
  render(<TemplatesDialog />);
  await user.click(screen.getByRole("button", { name: "Templates" }));
  await user.click(await screen.findByRole("button", { name: /^Reject rate by machine/ }));
  return user;
}

describe("TemplatesDialog", () => {
  const replace = vi.fn();
  beforeEach(() => setEditorContents({ get: () => "", replace }));
  afterEach(() => {
    act(() => {
      catalog.setTables([]);
      setChartPreset(null);
    });
    setEditorContents(null);
    vi.clearAllMocks();
  });

  it("maps a user's table and columns automatically and runs the template", async () => {
    const columns = [...userTable.columns.slice(0, 2), { name: "Scrap", type: "INTEGER" }];
    catalog.setTables([{ ...userTable, columns }]);
    const user = await openTemplate();

    expect(screen.getByLabelText("Table")).toHaveValue("line_qc");
    expect(screen.getByLabelText("Machine")).toHaveValue("Asset");
    expect(screen.getByLabelText("Checked at (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Inspected")).toHaveValue("Qty");
    expect(screen.getByLabelText("Rejected")).toHaveValue("Scrap");
    expect(screen.getByLabelText("Minimum inspected")).toHaveValue(0);

    await user.click(screen.getByRole("button", { name: "Run" }));
    const sql = replace.mock.calls[0]?.[0] as string;
    expect(sql).toContain('FROM "line_qc"');
    expect(sql).toContain('sum("Scrap")');
    expect(queryRun.runQuery).toHaveBeenCalledWith(sql);
    expect(getChartPreset()).toEqual({
      sql,
      type: "bar",
      x: "machine_id",
      y: "reject_rate_pct",
      aggregate: "avg",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables Run and says why while a column is missing or of the wrong type", async () => {
    catalog.setTables([userTable]);
    const user = await openTemplate();
    const run = screen.getByRole("button", { name: "Run" });

    expect(screen.getByLabelText("Rejected")).toHaveValue("");
    expect(screen.getByLabelText("Rejected")).toHaveAccessibleDescription(
      "Choose a column for Rejected.",
    );
    expect(run).toBeDisabled();
    expect(run).toHaveAccessibleDescription("Choose a column for Rejected.");

    await user.selectOptions(screen.getByLabelText("Rejected"), "Scrap");
    expect(run).toHaveAccessibleDescription("Rejected needs a number column; Scrap is VARCHAR.");
    expect(screen.getByLabelText("Rejected")).toHaveAttribute("aria-invalid", "true");

    await user.selectOptions(screen.getByLabelText("Table"), "");
    expect(run).toHaveAccessibleDescription("Choose a table for Quality checks.");
    expect(screen.getByLabelText("Machine")).toBeDisabled();
  });

  it("disables Run while a number parameter isn't a number", async () => {
    catalog.setTables([sampleTable]);
    const user = await openTemplate();
    await user.clear(screen.getByLabelText("Minimum inspected"));
    expect(screen.getByRole("button", { name: "Run" })).toHaveAccessibleDescription(
      "Minimum inspected must be a number.",
    );
  });

  it("loads the sample and maps it", async () => {
    samples.loadSample.mockImplementation(async () => catalog.setTables([sampleTable]));
    const user = await openTemplate();
    expect(screen.getByLabelText("Table")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Run" })).toHaveAccessibleDescription(
      "Choose a table for Quality checks.",
    );

    await user.click(screen.getByRole("button", { name: "Load sample data" }));
    expect(samples.loadSample).toHaveBeenCalledWith("quality_checks");
    expect(screen.getByLabelText("Table")).toHaveValue("quality_checks");
    expect(screen.getByLabelText("Checked at (optional)")).toHaveValue("checked_at");
    expect(screen.queryByRole("button", { name: "Load sample data" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("shows why the sample couldn't be loaded", async () => {
    samples.loadSample.mockRejectedValue(new Error("Out of memory"));
    const user = await openTemplate();
    await user.click(screen.getByRole("button", { name: "Load sample data" }));
    expect(await screen.findByText("Out of memory")).toBeInTheDocument();
  });

  it("goes back to the gallery", async () => {
    const user = await openTemplate();
    await user.click(screen.getByRole("button", { name: "All templates" }));
    expect(screen.getByRole("heading", { name: "Templates" })).toBeInTheDocument();
  });

  it("opens the gallery through its handle, such as from the command palette", () => {
    const dialog = createRef<TemplatesHandle>();
    render(<TemplatesDialog ref={dialog} />);

    act(() => dialog.current?.open());
    expect(screen.getByRole("dialog", { name: "Templates" })).toBeInTheDocument();
  });
});
