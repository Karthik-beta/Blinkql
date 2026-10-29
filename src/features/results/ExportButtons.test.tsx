import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tableFromArrays } from "apache-arrow";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportButtons, type ExportHandle } from "./ExportButtons";
import { resetQueryRun, runQuery } from "./query-run";
import { streamOf } from "./test-utils";

const exporter = vi.hoisted(() => ({
  exportResult: vi.fn(async (_sql: string, format: string) => `blinkql-result.${format}`),
  exportReport: vi.fn(async (_sql: string) => "blinkql-report.html"),
}));
vi.mock("./export", () => exporter);

const engine = vi.hoisted(() => ({
  streamQuery: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("@/engine/engine", () => engine);

async function finishQuery(sql: string) {
  engine.streamQuery.mockResolvedValueOnce(streamOf(tableFromArrays({ a: Int32Array.of(1) })));
  await act(() => runQuery(sql));
}

describe("ExportButtons", () => {
  afterEach(() => {
    act(() => resetQueryRun());
    vi.clearAllMocks();
  });

  it("is disabled until a query has finished", async () => {
    render(<ExportButtons />);
    expect(screen.getByRole("button", { name: "Export as CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export as Parquet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export as HTML report" })).toBeDisabled();

    await finishQuery("SELECT 1 AS a");
    expect(screen.getByRole("button", { name: "Export as CSV" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Export as Parquet" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Export as HTML report" })).toBeEnabled();
  });

  it("exports the last query's result and says when the download is ready", async () => {
    const user = userEvent.setup();
    render(<ExportButtons />);
    await finishQuery("SELECT 1 AS a");

    await user.click(screen.getByRole("button", { name: "Export as Parquet" }));

    expect(exporter.exportResult).toHaveBeenCalledWith("SELECT 1 AS a", "parquet");
    expect(await screen.findByText("Downloaded blinkql-result.parquet")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("exports the last query's result as an HTML report", async () => {
    const user = userEvent.setup();
    render(<ExportButtons />);
    await finishQuery("SELECT 1 AS a");

    await user.click(screen.getByRole("button", { name: "Export as HTML report" }));

    expect(exporter.exportReport).toHaveBeenCalledWith("SELECT 1 AS a");
    expect(exporter.exportResult).not.toHaveBeenCalled();
    expect(await screen.findByText("Downloaded blinkql-report.html")).toBeInTheDocument();
  });

  it("says why an export failed, in DuckDB's words", async () => {
    const user = userEvent.setup();
    render(<ExportButtons />);
    await finishQuery("CREATE TABLE t AS SELECT 1");
    exporter.exportResult.mockRejectedValueOnce(
      new Error(
        JSON.stringify({
          exception_type: "Parser",
          exception_message: 'syntax error at or near "CREATE"',
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Export as CSV" }));

    expect(
      await screen.findByText('Couldn\'t export: syntax error at or near "CREATE"'),
    ).toBeInTheDocument();
  });

  it("exports through its handle, such as from the command palette", async () => {
    const buttons = createRef<ExportHandle>();
    render(<ExportButtons ref={buttons} />);
    await finishQuery("SELECT 1 AS a");

    act(() => buttons.current?.exportAs("csv"));

    expect(exporter.exportResult).toHaveBeenCalledWith("SELECT 1 AS a", "csv");
    expect(await screen.findByText("Downloaded blinkql-result.csv")).toBeInTheDocument();

    act(() => buttons.current?.exportAs("report"));

    expect(exporter.exportReport).toHaveBeenCalledWith("SELECT 1 AS a");
    expect(await screen.findByText("Downloaded blinkql-report.html")).toBeInTheDocument();
  });
});
