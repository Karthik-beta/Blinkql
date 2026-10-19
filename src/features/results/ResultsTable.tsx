import { DataType } from "apache-arrow";
import { useEffect, useSyncExternalStore } from "react";
import { measureSince, measures } from "@/lib/user-timing";
import { getQueryRun, subscribeToQueryRun } from "./query-run";
import { getResult, readCell, subscribeToResult } from "./result-store";

/** Whether the last query failed: the one thing about the query run the table depends on. */
const lastRunFailed = () => getQueryRun().state === "failed";

/** Numbers line up on the right, so their digits do too. */
function alignment(type: DataType): string {
  return DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type)
    ? "text-right"
    : "text-left";
}

/**
 * The result on screen as a plain table, every row rendered.
 *
 * The table renders only when the result changes or a query fails: it subscribes to the result's
 * shape and to whether the last run failed, not to the query run, so starting the next query
 * doesn't render it again (P-03). Cells are read from the Arrow result as they render; nothing is
 * copied into row objects (P-02). There's no virtualization yet, so very large results are slow to
 * show; P-04 fixes that against the P-01 measurements.
 */
export function ResultsTable() {
  const results = useSyncExternalStore(subscribeToResult, getResult);
  const failed = useSyncExternalStore(subscribeToQueryRun, lastRunFailed);

  useEffect(() => {
    if (!results) return;
    // A timeout queued from requestAnimationFrame runs once that frame has been painted.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timeout = setTimeout(() => measureSince(measures.resultsRender, results.finishedAt));
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [results]);

  return (
    <section
      // Focusable so keyboard users can scroll it.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs to be focusable
      tabIndex={0}
      aria-label="Results"
      // A failed query has no results; its error panel, above, gets the room instead.
      hidden={failed}
      className="min-h-0 flex-1 overflow-auto border-t"
    >
      {results && (
        <table className="border-separate border-spacing-0 font-mono text-xs tabular-nums">
          <thead className="sticky top-0 bg-chrome">
            <tr>
              {results.columns.map((column, index) => (
                <th
                  // Columns can share a name, so the position is the key.
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns never reorder within a result
                  key={index}
                  scope="col"
                  className={`whitespace-nowrap border-r border-b px-2 py-1 font-medium ${alignment(column.type)}`}
                >
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: results.rowCount }, (_, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a result's rows never reorder
              <tr key={rowIndex}>
                {results.columns.map((column, columnIndex) => {
                  const text = readCell(rowIndex, columnIndex);
                  return (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: see the header row
                      key={columnIndex}
                      title={text ?? undefined}
                      className={`max-w-96 truncate whitespace-nowrap border-r border-b px-2 py-0.5 ${alignment(column.type)}`}
                    >
                      {text ?? <span className="text-muted-foreground">NULL</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
