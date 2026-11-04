import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tableFromArrays } from "apache-arrow";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChartPreset, setChartPreset } from "@/features/charts/chart-preset";
import { setShownChart } from "@/features/charts/chart-settings";
import { setEditorContents } from "@/features/editor/insert";
import { resetQueryRun, runQuery } from "@/features/results/query-run";
import { streamOf } from "@/features/results/test-utils";
import { ShareDialog, type ShareHandle } from "./ShareDialog";
import { decodeShareLink, encodeShareLink } from "./share-link";

const engine = vi.hoisted(() => ({
  streamQuery: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("@/engine/engine", () => engine);

async function finishQuery(sql: string) {
  engine.streamQuery.mockResolvedValueOnce(streamOf(tableFromArrays({ a: Int32Array.of(7) })));
  await act(() => runQuery(sql));
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Share" }));
  return { user, dialog: within(await screen.findByRole("dialog", { name: "Share query" })) };
}

describe("ShareDialog", () => {
  const replace = vi.fn();
  beforeEach(() => setEditorContents({ get: () => "", replace }));
  afterEach(() => {
    act(() => {
      resetQueryRun();
      setChartPreset(null);
    });
    setShownChart(null);
    setEditorContents(null);
    history.replaceState(null, "", "/");
    vi.clearAllMocks();
  });

  it("is disabled until a query has finished", async () => {
    render(<ShareDialog />);
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    await finishQuery("SELECT 7 AS a");
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled();
  });

  it("opens through its handle, such as from the command palette, once a query has finished", async () => {
    const share = createRef<ShareHandle>();
    render(<ShareDialog ref={share} />);
    act(() => share.current?.open());
    expect(screen.queryByRole("dialog")).toBeNull();

    await finishQuery("SELECT 7 AS a");
    act(() => share.current?.open());
    expect(await screen.findByRole("dialog", { name: "Share query" })).toBeInTheDocument();
  });

  it("links to the last query and the chart on screen, and says the link holds no data", async () => {
    render(<ShareDialog />);
    await finishQuery("SELECT a FROM t LIMIT 5");
    setShownChart({ type: "bar", x: "a", aggregate: "count" });
    const { dialog } = await openDialog();

    const link = new URL((dialog.getByLabelText("Link") as HTMLInputElement).value);
    expect(link.pathname).toBe(location.pathname);
    expect(decodeShareLink(link.hash)).toEqual({
      sql: "SELECT a FROM t LIMIT 5",
      chart: { type: "bar", x: "a", aggregate: "count" },
    });
    expect(dialog.getByLabelText("Link")).toHaveAttribute("readonly");
    expect(dialog.getByText(/holds the query and chart settings, but no data/)).toBeInTheDocument();
    expect(dialog.queryByText(/values/)).toBeNull();
  });

  it("leaves the chart out while none is on screen", async () => {
    render(<ShareDialog />);
    await finishQuery("SELECT a FROM t");
    const { dialog } = await openDialog();
    const link = new URL((dialog.getByLabelText("Link") as HTMLInputElement).value);
    expect(decodeShareLink(link.hash)).toEqual({ sql: "SELECT a FROM t" });
  });

  it("warns about the values written into the query", async () => {
    render(<ShareDialog />);
    await finishQuery("SELECT a FROM t WHERE customer = 'Acme' AND total > 42");
    const { dialog } = await openDialog();
    const warning = dialog.getByText(/anyone with the link can read/);
    expect(warning).toBeInTheDocument();
    expect(dialog.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "'Acme'",
      "42",
    ]);
  });

  it("copies the link and says so", async () => {
    render(<ShareDialog />);
    await finishQuery("SELECT a FROM t");
    const { user, dialog } = await openDialog();
    await user.click(dialog.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(
      (dialog.getByLabelText("Link") as HTMLInputElement).value,
    );
    expect(dialog.getByText("Link copied")).toHaveAttribute("aria-live", "polite");
  });

  it("opens a shared query in the editor with its chart, without running it", async () => {
    const chart = { type: "line" as const, x: "day", y: "total", aggregate: "sum" as const };
    history.replaceState(
      null,
      "",
      `/app/?downsample=sql${encodeShareLink({ sql: "SELECT 1", chart })}`,
    );
    render(<ShareDialog />);

    expect(replace).toHaveBeenCalledWith("SELECT 1");
    expect(getChartPreset()).toEqual({ sql: "SELECT 1", ...chart });
    expect(engine.streamQuery).not.toHaveBeenCalled();
    expect(screen.getByText(/Opened a shared query/)).toHaveAttribute("aria-live", "polite");
    expect(location.hash).toBe("");
    expect(location.search).toBe("?downsample=sql");

    // The message is about the shared query, so it goes once a query runs.
    await finishQuery("SELECT 1");
    expect(screen.queryByText(/Opened a shared query/)).toBeNull();
  });

  it("says when a share link can't be read, and opens nothing", () => {
    history.replaceState(null, "", "/app/#share=1.garbled!");
    render(<ShareDialog />);
    expect(screen.getByText(/couldn't be read/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(getChartPreset()).toBeNull();
    expect(location.hash).toBe("");
  });

  it("leaves other fragments alone", () => {
    history.replaceState(null, "", "/app/#section");
    render(<ShareDialog />);
    expect(location.hash).toBe("#section");
    expect(replace).not.toHaveBeenCalled();
  });
});
