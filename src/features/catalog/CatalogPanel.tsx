import { FileUp } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { getCatalog, importFiles, subscribeToCatalog } from "./catalog";
import { acceptedExtensions, type FileFormat } from "./formats";

const formatLabels: Readonly<Record<FileFormat, string>> = {
  csv: "CSV",
  parquet: "Parquet",
  json: "JSON",
  jsonl: "JSON lines",
};

/** The table list, with a button that opens the file picker. */
export function CatalogPanel() {
  const catalog = useSyncExternalStore(subscribeToCatalog, getCatalog);
  const input = useRef<HTMLInputElement>(null);

  return (
    <aside
      aria-labelledby="catalog-heading"
      className="flex w-64 shrink-0 flex-col gap-3 border-r bg-chrome p-3"
    >
      <div className="flex items-center justify-between">
        <h2 id="catalog-heading" className="font-medium text-xs">
          Tables
        </h2>
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          <FileUp data-icon="inline-start" aria-hidden />
          Import files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={acceptedExtensions}
          className="hidden"
          aria-label="Import files"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            // Clear the selection so picking the same file again still fires a change event.
            event.currentTarget.value = "";
            void importFiles(files);
          }}
        />
      </div>

      {catalog.tables.length === 0 && catalog.importing.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No tables yet. Drop a CSV, Parquet or JSON file anywhere, or use Import files.
        </p>
      ) : (
        <ul aria-label="Tables" className="flex flex-col gap-1">
          {catalog.tables.map((table) => (
            <li key={table.name} className="flex flex-col rounded-md px-2 py-1">
              <span className="truncate font-mono text-xs" title={table.fileName}>
                {table.name}
              </span>
              <span className="text-muted-foreground text-xs">
                {formatLabels[table.format]} · {table.columnCount}{" "}
                {table.columnCount === 1 ? "column" : "columns"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div aria-live="polite" className="text-muted-foreground text-xs">
        {catalog.importing.length > 0 && <p>Importing {catalog.importing.join(", ")}…</p>}
      </div>

      {catalog.failures.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-destructive text-xs">
          {catalog.failures.map((failure) => (
            <li key={failure.fileName}>
              Couldn't import {failure.fileName}: {failure.message}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
