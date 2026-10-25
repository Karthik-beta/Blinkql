// Exporting the last query's result as a file to download. The engine writes the file in its
// worker (exportQuery), so a large result doesn't hold up the page while it's formatted.
import { exportQuery } from "@/engine/engine";
import { withoutFinalSemicolon } from "@/features/charts/chart-sql";

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

/** Exports the result of `sql` as a `format` file, downloads it and resolves with its name. */
export async function exportResult(sql: string, format: ExportFormat): Promise<string> {
  const bytes = await exportQuery(withoutFinalSemicolon(sql), format);
  const name = exportFileName(format);
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME_TYPES[format] }));
  download(url, name);
  // Revoked later rather than straight away, which can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}
