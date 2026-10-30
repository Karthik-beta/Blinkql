import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEditorInserter } from "@/features/editor/insert";
import { type CatalogHandle, CatalogPanel } from "./CatalogPanel";
import { importFiles, resetCatalog } from "./catalog";

// The engine is replaced by a fake that knows two tables' columns. Column statistics wait until
// the test settles them; exact distinct counts come back at once.
const engine = vi.hoisted(() => {
  const columns: Record<string, [string, string][]> = {
    orders: [
      ["id", "BIGINT"],
      ["Order Date", "DATE"],
    ],
    machines: [["machine_id", "VARCHAR"]],
    machine_events: [
      ["ts", "TIMESTAMP"],
      ["machine_id", "VARCHAR"],
      ["event", "VARCHAR"],
    ],
    plants: [
      ["plant_code", "VARCHAR"],
      ["plant_name", "VARCHAR"],
    ],
  };
  let settle: { resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null;
  return {
    query: vi.fn(async (sql: string): Promise<unknown> => {
      if (sql.startsWith("DESCRIBE")) {
        const rows = columns[sql.slice('DESCRIBE "'.length, -1)] ?? [];
        return {
          numRows: rows.length,
          toArray: () => rows.map(([column_name, column_type]) => ({ column_name, column_type })),
        };
      }
      if (sql.includes("count(DISTINCT")) {
        return { toArray: () => [{ "Order Date": 30n }] };
      }
      if (sql.includes("SUMMARIZE")) {
        return new Promise((resolve, reject) => {
          settle = { resolve, reject };
        });
      }
      return {};
    }),
    registerFile: vi.fn(async (_name: string, _file: File) => {}),
    registerUrl: vi.fn(async (_name: string, _url: string) => {}),
    unregisterFile: vi.fn(async (_name: string) => {}),
    exportQuery: vi.fn(async (_sql: string, _format: string) => new Uint8Array(2048)),
    finish: (rows: object[]) => settle?.resolve({ toArray: () => rows }),
    fail: (error: Error) => settle?.reject(error),
  };
});
vi.mock("@/engine/engine", () => engine);
const queryRun = vi.hoisted(() => ({ runQuery: vi.fn(async (_sql: string) => {}) }));
vi.mock("@/features/results/query-run", () => queryRun);
// Remote servers answer the first-byte check with a range unless a test says otherwise.
const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("P", { status: 206 }));
vi.stubGlobal("fetch", fetch);
const storage = vi.hoisted(() => ({
  saveDataset: vi.fn(async () => {}),
  listDatasets: vi.fn(async () => []),
  loadDataset: vi.fn(),
  removeDataset: vi.fn(async (_name: string) => {}),
}));
vi.mock("./stored-datasets", () => storage);

const summarized = (sql: string) => sql.includes("SUMMARIZE");

async function renderWithTables() {
  await importFiles([new File(["x"], "orders.csv"), new File(["x"], "machines.csv")]);
  render(<CatalogPanel />);
  return screen.getByRole("tree", { name: "Tables" });
}

describe("CatalogPanel", () => {
  const insert = vi.fn();
  beforeEach(() => setEditorInserter(insert));
  afterEach(() => {
    act(() => resetCatalog());
    setEditorInserter(null);
    vi.clearAllMocks();
  });

  it("lists tables as a collapsed tree with one Tab stop", async () => {
    const tree = await renderWithTables();

    const tables = within(tree).getAllByRole("treeitem");
    expect(tables).toHaveLength(2);
    expect(
      within(tree).getByRole("treeitem", { name: "orders CSV · 2 columns · 1 B · orders.csv" }),
    ).toBe(tables[0]);
    expect(
      within(tree).getByRole("treeitem", { name: "machines CSV · 1 column · 1 B · machines.csv" }),
    ).toBe(tables[1]);
    expect(tables[0]).toHaveAttribute("aria-expanded", "false");
    expect(tables.map((table) => table.tabIndex)).toEqual([0, -1]);
    expect(engine.query.mock.calls.map(([sql]) => sql).some(summarized)).toBe(false);
  });

  it("titles a table with its full name and shows the file it came from", async () => {
    await importFiles([new File(["x"], "Machine Events.csv")]);
    render(<CatalogPanel />);

    const table = screen.getByRole("treeitem", {
      name: "machine_events CSV · 3 columns · 1 B · Machine Events.csv",
    });
    expect(within(table).getByText("machine_events")).toHaveAttribute("title", "machine_events");
    expect(within(table).getByText(/^CSV ·/).textContent).toMatch(/ · Machine Events\.csv$/);
  });

  it("moves through tables and columns with the arrow keys", async () => {
    const tree = await renderWithTables();
    const [orders, machines] = within(tree).getAllByRole("treeitem");
    act(() => within(tree).getAllByRole("treeitem")[0]?.focus());
    expect(orders).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(machines).toHaveFocus();
    expect(machines?.tabIndex).toBe(0);
    await userEvent.keyboard("{ArrowUp}");
    expect(orders).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    expect(orders).toHaveAttribute("aria-expanded", "true");
    const columns = within(within(tree).getByRole("group")).getAllByRole("treeitem");
    expect(columns.map((column) => column.textContent)).toEqual([
      expect.stringContaining("idBIGINT"),
      expect.stringContaining("Order DateDATE"),
    ]);

    await userEvent.keyboard("{ArrowRight}");
    expect(columns[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(columns[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(machines).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowLeft}");
    expect(orders).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(orders).toHaveAttribute("aria-expanded", "false");
    expect(within(tree).queryByRole("group")).not.toBeInTheDocument();
  });

  it("inserts table and column names with Enter or a click, quoted when needed", async () => {
    const tree = await renderWithTables();
    act(() => within(tree).getAllByRole("treeitem")[0]?.focus());
    await userEvent.keyboard("{Enter}");
    expect(insert).toHaveBeenLastCalledWith("orders");

    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}{Enter}");
    expect(insert).toHaveBeenLastCalledWith('"Order Date"');

    await userEvent.click(within(tree).getByText("id"));
    expect(insert).toHaveBeenLastCalledWith("id");
    await userEvent.click(within(tree).getByText("machines"));
    expect(insert).toHaveBeenLastCalledWith("machines");
    expect(insert).toHaveBeenCalledTimes(4);
  });

  it("profiles a table with its button or P, without inserting its name", async () => {
    const tree = await renderWithTables();

    await userEvent.click(within(tree).getByRole("button", { name: "Profile orders" }));
    expect(queryRun.runQuery).toHaveBeenLastCalledWith('SUMMARIZE "orders"');

    act(() => within(tree).getAllByRole("treeitem")[1]?.focus());
    await userEvent.keyboard("p");
    expect(queryRun.runQuery).toHaveBeenLastCalledWith('SUMMARIZE "machines"');
    expect(insert).not.toHaveBeenCalled();
  });

  it("shows a table's rows with its button or R, without inserting its name", async () => {
    const tree = await renderWithTables();
    const [orders] = within(tree).getAllByRole("treeitem");
    expect(orders).toHaveAttribute("aria-keyshortcuts", "C P R Delete");

    const button = within(tree).getByRole("button", { name: "Show rows of orders" });
    expect(button.tabIndex).toBe(-1);
    await userEvent.click(button);
    expect(queryRun.runQuery).toHaveBeenLastCalledWith('SELECT * FROM "orders"');

    act(() => within(tree).getAllByRole("treeitem")[1]?.focus());
    await userEvent.keyboard("r");
    expect(queryRun.runQuery).toHaveBeenLastCalledWith('SELECT * FROM "machines"');
    expect(insert).not.toHaveBeenCalled();
  });

  it("converts a CSV table to Parquet with its button or C, saying while it does", async () => {
    await importFiles([
      new File(["x"], "orders.csv"),
      new File(["x"], "machines.csv"),
      new File(["x"], "events.parquet"),
      new URL("https://example.com/remote.csv"),
    ]);
    render(<CatalogPanel />);
    const tree = screen.getByRole("tree", { name: "Tables" });
    const [, , events, remote] = within(tree).getAllByRole("treeitem");
    // Only local CSV files are converted.
    expect(events).toHaveAttribute("aria-keyshortcuts", "P R Delete");
    expect(remote).toHaveAttribute("aria-keyshortcuts", "P R Delete");
    for (const name of ["events", "remote"]) {
      expect(
        within(tree).queryByRole("button", { name: `Convert ${name} to Parquet` }),
      ).not.toBeInTheDocument();
    }

    let finish = (_bytes: Uint8Array<ArrayBuffer>) => {};
    engine.exportQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const button = within(tree).getByRole("button", { name: "Convert orders to Parquet" });
    expect(button.tabIndex).toBe(-1);
    await userEvent.click(button);
    expect(
      within(tree).getByRole("treeitem", {
        name: "orders CSV · 2 columns · 1 B · orders.csv · Converting to Parquet…",
      }),
    ).toBeVisible();
    expect(button).toBeDisabled();

    await act(async () => finish(new Uint8Array(2048)));
    expect(
      within(tree).getByRole("treeitem", {
        name: "orders Parquet · 2 columns · 2 KB · orders.csv",
      }),
    ).toBeVisible();
    expect(
      within(tree).queryByRole("button", { name: "Convert orders to Parquet" }),
    ).not.toBeInTheDocument();

    act(() => within(tree).getAllByRole("treeitem")[1]?.focus());
    await userEvent.keyboard("c");
    expect(engine.exportQuery).toHaveBeenLastCalledWith(
      "SELECT * FROM read_csv('machines.csv')",
      "parquet",
    );
    expect(
      await within(tree).findByRole("treeitem", {
        name: "machines Parquet · 1 column · 2 KB · machines.csv",
      }),
    ).toBeVisible();
    expect(insert).not.toHaveBeenCalled();
  });

  it("explains when a table can't be converted", async () => {
    engine.exportQuery.mockRejectedValueOnce(new Error("Out of Memory Error: could not allocate"));
    const tree = await renderWithTables();

    await userEvent.click(within(tree).getByRole("button", { name: "Convert orders to Parquet" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't convert orders.csv to Parquet: Out of Memory Error: could not allocate",
    );
    expect(
      within(tree).getByRole("treeitem", { name: "orders CSV · 2 columns · 1 B · orders.csv" }),
    ).toBeVisible();
  });

  it("shows each table's size", async () => {
    await importFiles([new File([new Uint8Array(1536)], "orders.csv")]);
    render(<CatalogPanel />);

    expect(
      screen.getByRole("treeitem", { name: "orders CSV · 2 columns · 1.5 KB · orders.csv" }),
    ).toBeVisible();
  });

  it("forgets a table with its button or Delete, without inserting its name", async () => {
    const tree = await renderWithTables();

    const button = within(tree).getByRole("button", { name: "Forget orders" });
    expect(button.tabIndex).toBe(-1);
    await userEvent.click(button);
    expect(storage.removeDataset).toHaveBeenLastCalledWith("orders");
    expect(
      within(tree)
        .getAllByRole("treeitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("machines")]);

    act(() => within(tree).getAllByRole("treeitem")[0]?.focus());
    await userEvent.keyboard("{Delete}");
    expect(storage.removeDataset).toHaveBeenLastCalledWith("machines");
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(insert).not.toHaveBeenCalled();
  });

  it("says when files can't be kept after a reload", async () => {
    storage.saveDataset.mockRejectedValueOnce(new Error("QuotaExceededError"));
    await renderWithTables();

    expect(
      await screen.findByText(
        "This browser can't keep these files, so their tables will be gone after a reload.",
      ),
    ).toBeVisible();
  });

  it("loads column statistics when a table is first expanded", async () => {
    const tree = await renderWithTables();
    act(() => within(tree).getAllByRole("treeitem")[0]?.focus());
    await userEvent.keyboard("{ArrowRight}");

    expect(within(tree).getByText("Loading column statistics…")).toBeInTheDocument();
    expect(engine.query).toHaveBeenLastCalledWith(expect.stringContaining('SUMMARIZE "orders"'));
    await act(async () =>
      engine.finish([
        { column_name: "id", null_percentage: 0, distinct_count: 1200 },
        { column_name: "Order Date", null_percentage: 12.5, distinct_count: 31 },
      ]),
    );

    expect(within(tree).queryByText("Loading column statistics…")).not.toBeInTheDocument();
    const columns = within(within(tree).getByRole("group")).getAllByRole("treeitem");
    expect(columns[0]).toHaveTextContent("0% null · ~1,200 distinct");
    // An estimate this small is replaced by the exact count.
    expect(columns[1]).toHaveTextContent("12.5% null · 30 distinct");
    expect(engine.query).toHaveBeenLastCalledWith(
      'SELECT count(DISTINCT "Order Date") AS "Order Date" FROM "orders"',
    );

    // Collapsing and expanding again reuses the statistics.
    await userEvent.keyboard("{ArrowLeft}{ArrowRight}");
    expect(within(tree).getAllByText(/% null/)).toHaveLength(2);
    expect(engine.query.mock.calls.map(([sql]) => sql).filter(summarized)).toHaveLength(1);
  });

  it("explains when column statistics can't be loaded", async () => {
    const tree = await renderWithTables();
    act(() => within(tree).getAllByRole("treeitem")[0]?.focus());
    await userEvent.keyboard("{ArrowRight}");

    await act(async () => engine.fail(new Error("Out of Memory Error: could not allocate")));

    expect(within(tree).getByText(/^Couldn't load column statistics:/)).toHaveTextContent(
      "could not allocate",
    );
    expect(within(within(tree).getByRole("group")).getAllByRole("treeitem")).toHaveLength(2);
  });

  it("adds a remote file from a labelled dialog, submitted with Enter", async () => {
    render(<CatalogPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Add from URL" }));
    const dialog = screen.getByRole("dialog", { name: "Add a file from a URL" });
    const url = within(dialog).getByRole("textbox", { name: "URL" });
    expect(url).toHaveFocus();
    await userEvent.type(url, "https://example.com/data/orders.parquet{Enter}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(engine.registerUrl).toHaveBeenCalledWith(
      "orders.parquet",
      "https://example.com/data/orders.parquet",
    );
    expect(
      await screen.findByRole("treeitem", {
        name: "orders Parquet · 2 columns · https://example.com/data/orders.parquet",
      }),
    ).toBeInTheDocument();
  });

  it("warns about a remote file that will be downloaded whole", async () => {
    fetch.mockResolvedValueOnce(new Response("the whole file", { status: 200 }));
    render(<CatalogPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Add from URL" }));
    // Typed into the field itself: the dialog may not have moved focus into it yet.
    const dialog = screen.getByRole("dialog", { name: "Add a file from a URL" });
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "URL" }),
      "https://example.com/orders.parquet{Enter}",
    );

    expect(
      await screen.findByText(
        "https://example.com/orders.parquet: The server doesn't support range requests, so the whole file is downloaded every time it's read.",
      ),
    ).toBeInTheDocument();
  });

  it("explains an address it can't read and keeps the dialog open", async () => {
    render(<CatalogPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Add from URL" }));
    const dialog = screen.getByRole("dialog", { name: "Add a file from a URL" });
    const url = within(dialog).getByRole("textbox", { name: "URL" });
    await userEvent.type(url, "http://example.com/orders.parquet");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(url).toHaveAccessibleDescription("Only https:// addresses can be read.");
    expect(engine.registerUrl).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads a sample from a labelled dialog, by keyboard", async () => {
    render(<CatalogPanel />);

    screen.getByRole("button", { name: "Load sample data" }).focus();
    await userEvent.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Load sample data" });
    within(dialog)
      .getByRole("button", { name: /^Plants/ })
      .focus();
    await userEvent.keyboard("{Enter}");

    expect(engine.exportQuery).toHaveBeenCalledWith(expect.stringContaining("P100"), "parquet");
    expect(
      await screen.findByRole("treeitem", {
        name: "plants Parquet · 2 columns · 2 KB · plants.parquet",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Load sample data" }));
    expect(screen.getByRole("button", { name: /^Plants \(loaded\)/ })).toBeDisabled();
  });

  it("explains a sample it can't load and keeps the dialog open", async () => {
    engine.exportQuery.mockRejectedValueOnce(new Error("Out of memory"));
    render(<CatalogPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Load sample data" }));
    await userEvent.click(screen.getByRole("button", { name: /^Plants/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the sample: Out of memory",
    );
    expect(screen.getByRole("dialog", { name: "Load sample data" })).toBeInTheDocument();
  });

  it("opens the file picker and loads samples through its handle, such as from the palette", async () => {
    const catalog = createRef<CatalogHandle>();
    render(<CatalogPanel ref={catalog} />);
    const click = vi.spyOn(screen.getByLabelText("Import files"), "click");

    act(() => catalog.current?.importFiles());
    expect(click).toHaveBeenCalledOnce();

    act(() => catalog.current?.loadSample("plants"));
    expect(screen.getByRole("dialog", { name: "Load sample data" })).toBeInTheDocument();
    expect(await screen.findByRole("treeitem", { name: /^plants / })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("warns, without blocking the import, when a file is large for the device", async () => {
    const file = new File(["x"], "orders.csv");
    Object.defineProperty(file, "size", { value: 3 * 2 ** 30 });
    await importFiles([file]);
    render(<CatalogPanel />);

    expect(
      screen.getByRole("treeitem", { name: "orders CSV · 2 columns · 3 GB · orders.csv" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/orders\.csv.*large for this device/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
