// Buttons that download the last finished query's result as CSV or Parquet.
import { Download } from "lucide-react";
import { type Ref, useImperativeHandle, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { parseEngineError } from "./engine-error";
import { type ExportFormat, exportResult } from "./export";
import { getQueryRun, subscribeToQueryRun } from "./query-run";

/** The formats a result can be exported as. */
export const exportFormats: readonly { format: ExportFormat; label: string }[] = [
  { format: "csv", label: "CSV" },
  { format: "parquet", label: "Parquet" },
];

type Outcome = { message: string; failed: boolean };

export type ExportHandle = {
  /** Exports the last result, as its button does. */
  exportAs(format: ExportFormat): void;
};

export function ExportButtons({ ref }: { ref?: Ref<ExportHandle> }) {
  const run = useSyncExternalStore(subscribeToQueryRun, getQueryRun);
  const [exporting, setExporting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const sql = run.state === "done" ? run.sql : null;

  const exportAs = async (format: ExportFormat) => {
    // Ignored rather than disabled while exporting, so the button keeps keyboard focus.
    if (!sql || exporting) return;
    setExporting(true);
    setOutcome({ message: "Exporting…", failed: false });
    try {
      const name = await exportResult(sql, format);
      setOutcome({ message: `Downloaded ${name}`, failed: false });
    } catch (error) {
      const { message } = parseEngineError(
        error instanceof Error ? error : new Error(String(error)),
        sql,
      );
      setOutcome({ message: `Couldn't export: ${message.split("\n")[0]}`, failed: true });
    } finally {
      setExporting(false);
    }
  };

  useImperativeHandle(ref, () => ({ exportAs: (format) => void exportAs(format) }));

  return (
    <div className="ml-auto flex min-w-0 items-center gap-1">
      <span
        aria-live="polite"
        className={`min-w-0 truncate text-xs ${outcome?.failed ? "text-destructive" : "text-muted-foreground"}`}
      >
        {outcome?.message}
      </span>
      <fieldset aria-label="Export" className="flex items-center gap-1">
        <Download aria-hidden className="size-3.5 text-muted-foreground" />
        {exportFormats.map(({ format, label }) => (
          <Button
            key={format}
            variant="ghost"
            size="sm"
            aria-label={`Export as ${label}`}
            disabled={!sql}
            aria-busy={exporting}
            onClick={() => void exportAs(format)}
          >
            {label}
          </Button>
        ))}
      </fieldset>
    </div>
  );
}
