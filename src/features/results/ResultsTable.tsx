import { DataType, type Field } from "apache-arrow";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatCell, type Row, toRowObjects } from "./cells";
import { getQueryRun, subscribeToQueryRun } from "./query-run";

type Results = { columns: readonly Field[]; rows: readonly Row[] };

/** Numbers line up on the right, so their digits do too. */
function alignment(type: DataType): string {
  return DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type)
    ? "text-right"
    : "text-left";
}

/**
 * The last query's result as a plain table, every row rendered.
 *
 * This is the M1 baseline (#15) and deliberately naive: rows are copied out of Arrow into React
 * state, and there's no virtualization, so very large results are slow to show. P-02 to P-04 fix
 * that against the P-01 measurements; don't optimise it before then.
 */
export function ResultsTable() {
  const run = useSyncExternalStore(subscribeToQueryRun, getQueryRun);
  const [results, setResults] = useState<Results | null>(null);

  useEffect(() => {
    if (run.state === "done") {
      setResults({ columns: run.table.schema.fields, rows: toRowObjects(run.table) });
    } else if (run.state !== "running") {
      setResults(null);
    }
    // Keeps the previous result on screen while the next query runs.
  }, [run]);

  return (
    <section
      // Focusable so keyboard users can scroll it.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region needs to be focusable
      tabIndex={0}
      aria-label="Results"
      // A failed query has no results; its error panel, above, gets the room instead.
      hidden={run.state === "failed"}
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
            {results.rows.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a result's rows never reorder
              <tr key={rowIndex}>
                {results.columns.map((column, columnIndex) => {
                  const text = formatCell(row[columnIndex], column.type);
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
