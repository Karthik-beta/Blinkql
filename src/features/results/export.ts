// Exporting the last query's result as a file to download. The engine writes CSV and Parquet in
// its worker (exportQuery), so a large result doesn't hold up the page while it's formatted. An
// HTML report shows at most REPORT_ROWS rows, so it's made here from the result on screen.
import { exportQuery } from "@/engine/engine";
import { getShownChartPicture } from "@/features/charts/chart-settings";
import { withoutFinalSemicolon } from "@/features/charts/chart-sql";
import { isNumeric } from "./cells";
import { REPORT_ROWS, reportHtml } from "./report";
import { getResult, readCell } from "./result-store";

export type ExportFormat = "csv" | "parquet";

const MIME_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv",
  parquet: "application/vnd.apache.parquet",
};

/** A file name for an export made at `time`, e.g. "blinkql-result-2026-10-25-090503.csv". */
export function exportFileName(extension: string, time = new Date(), kind = "result"): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const date = `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())}`;
  const clock = `${two(time.getHours())}${two(time.getMinutes())}${two(time.getSeconds())}`;
  return `blinkql-${kind}-${date}-${clock}.${extension}`;
}

/** Has the browser download `url` as `name`. */
export function download(url: string, name: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}

/** Has the browser download `blob` as `name`. */
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  download(url, name);
  // Revoked later rather than straight away, which can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Exports the result of `sql` as a `format` file, downloads it and resolves with its name. */
export async function exportResult(sql: string, format: ExportFormat): Promise<string> {
  const bytes = await exportQuery(withoutFinalSemicolon(sql), format);
  const name = exportFileName(format);
  downloadBlob(new Blob([bytes], { type: MIME_TYPES[format] }), name);
  return name;
}

/**
 * Downloads an HTML report of `sql` and its result on screen, with the chart on screen if there
 * is one, and resolves with its name. Its rows read as the results table shows them.
 */
export async function exportReport(sql: string): Promise<string> {
  const result = getResult();
  if (!result) throw new Error("There's no result to export.");
  const createdAt = new Date();
  // Read before waiting for the chart, while the result on screen is still this one.
  const rows = Array.from({ length: Math.min(result.rowCount, REPORT_ROWS) }, (_, row) =>
    result.columns.map((_, column) => readCell(row, column)),
  );
  const html = reportHtml({
    title: "Blinkql report",
    createdAt,
    sql,
    columns: result.columns.map(({ name, type }) => ({ name, numeric: isNumeric(type) })),
    rows,
    rowCount: result.rowCount,
    chart: await getShownChartPicture(),
  });
  const name = exportFileName("html", createdAt, "report");
  downloadBlob(new Blob([html], { type: "text/html" }), name);
  return name;
}
