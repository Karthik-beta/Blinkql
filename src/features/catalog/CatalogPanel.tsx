import { ChevronRight, FileUp, ScanSearch } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { insertIntoEditor } from "@/features/editor/insert";
import { parseEngineError } from "@/features/results/engine-error";
import { runQuery } from "@/features/results/query-run";
import {
  getCatalog,
  type ImportedTable,
  importFiles,
  profileSql,
  subscribeToCatalog,
  type TableColumn,
} from "./catalog";
import { type ColumnStats, loadColumnStats } from "./column-stats";
import { acceptedExtensions, type FileFormat, sqlName } from "./formats";

const formatLabels: Readonly<Record<FileFormat, string>> = {
  csv: "CSV",
  parquet: "Parquet",
  json: "JSON",
  jsonl: "JSON lines",
};

const count = new Intl.NumberFormat();

/** A row of the schema tree: a table, or one of its columns. */
type TreeNode = { key: string; table: ImportedTable; column?: TableColumn };

type StatsState =
  | { state: "loading" }
  | { state: "done"; stats: ReadonlyMap<string, ColumnStats> }
  | { state: "failed"; message: string };

function useColumnStats(table: ImportedTable): StatsState {
  const [stats, setStats] = useState<StatsState>({ state: "loading" });
  useEffect(() => {
    let current = true;
    setStats({ state: "loading" });
    loadColumnStats(table).then(
      (loaded) => current && setStats({ state: "done", stats: loaded }),
      (error: unknown) =>
        current &&
        setStats({
          state: "failed",
          message:
            error instanceof Error
              ? parseEngineError(error, "", { preservePlainText: true }).message
              : String(error),
        }),
    );
    return () => {
      current = false;
    };
  }, [table]);
  return stats;
}

const itemClass = "rounded-md outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2";

type ItemProps = (node: TreeNode) => {
  tabIndex: number;
  ref: (element: HTMLDivElement | null) => void;
  onFocus: (event: FocusEvent) => void;
  onClick: (event: { stopPropagation(): void }) => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

function profile(table: ImportedTable): void {
  void runQuery(profileSql(table.name));
}

function TableItem({
  table,
  expanded,
  onToggle,
  itemProps,
}: {
  table: ImportedTable;
  expanded: boolean;
  onToggle: () => void;
  itemProps: ItemProps;
}) {
  const labelId = useId();
  const columns = table.columns.length;
  const { tabIndex, ...handlers } = itemProps({ key: table.name, table });
  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-labelledby={labelId}
      aria-keyshortcuts="P"
      className={itemClass}
      tabIndex={tabIndex}
      {...handlers}
    >
      <div className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-muted">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <ChevronRight className={`size-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        <div id={labelId} className="flex min-w-0 flex-1 flex-col">
          <div className="truncate font-mono text-xs" title={table.fileName}>
            {table.name}
          </div>
          <div className="text-muted-foreground text-xs">
            {formatLabels[table.format]} · {columns} {columns === 1 ? "column" : "columns"}
          </div>
        </div>
        {/* Out of the Tab order, like the chevron: from the keyboard, P profiles the table. The
            profile shows in the results grid, like any query, so it needs no SQL. */}
        <Button
          variant="ghost"
          size="icon-sm"
          tabIndex={-1}
          aria-label={`Profile ${table.name}`}
          title="Profile (P): types, ranges, distinct values and nulls per column"
          onClick={(event) => {
            event.stopPropagation();
            profile(table);
          }}
        >
          <ScanSearch aria-hidden />
        </Button>
      </div>
      {expanded && <ColumnGroup table={table} itemProps={itemProps} />}
    </div>
  );
}

function ColumnGroup({ table, itemProps }: { table: ImportedTable; itemProps: ItemProps }) {
  const stats = useColumnStats(table);
  return (
    <>
      {stats.state === "loading" && (
        <p className="pl-6 text-muted-foreground text-xs">Loading column statistics…</p>
      )}
      {stats.state === "failed" && (
        <p className="pl-6 text-destructive text-xs">
          Couldn't load column statistics: {stats.message}
        </p>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a tree's children sit in a role="group", not a <fieldset> */}
      <div role="group" className="flex flex-col pl-5">
        {table.columns.map((column, index) => {
          const columnStats = stats.state === "done" ? stats.stats.get(column.name) : undefined;
          const { tabIndex, ...handlers } = itemProps({
            key: `${table.name}/${index}`,
            table,
            column,
          });
          return (
            <div
              key={column.name}
              role="treeitem"
              className={`flex flex-col px-1 py-0.5 hover:bg-muted ${itemClass}`}
              tabIndex={tabIndex}
              {...handlers}
            >
              <span className="flex items-center gap-1.5">
                <span className="truncate font-mono text-xs">{column.name}</span>
                <span className="shrink-0 rounded-sm border px-1 font-mono text-[10px] text-muted-foreground">
                  {column.type}
                </span>
              </span>
              {columnStats && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {count.format(columnStats.nullPercentage)}% null · ~
                  {count.format(columnStats.distinctCount)} distinct
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * The schema browser: a tree of tables and their columns (the ARIA tree pattern, one Tab stop),
 * with a button that opens the file picker. Clicking a name, or pressing Enter on it, inserts it
 * into the editor.
 */
export function CatalogPanel() {
  const catalog = useSyncExternalStore(subscribeToCatalog, getCatalog);
  const input = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLDivElement>());

  const nodes: TreeNode[] = catalog.tables.flatMap((table) => [
    { key: table.name, table },
    ...(expanded.has(table.name)
      ? table.columns.map((column, index) => ({ key: `${table.name}/${index}`, table, column }))
      : []),
  ]);
  const tabStop = nodes.some((node) => node.key === active) ? active : nodes[0]?.key;

  const toggle = (table: string, open = !expanded.has(table)) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(table);
      else next.delete(table);
      return next;
    });
  const focus = (node: TreeNode | undefined) => node && items.current.get(node.key)?.focus();
  const insert = (node: TreeNode) =>
    insertIntoEditor(sqlName(node.column?.name ?? node.table.name));

  const onKeyDown = (event: KeyboardEvent, node: TreeNode) => {
    const index = nodes.findIndex((other) => other.key === node.key);
    const isOpen = !node.column && expanded.has(node.table.name);
    switch (event.key) {
      case "ArrowDown":
        focus(nodes[index + 1]);
        break;
      case "ArrowUp":
        focus(nodes[index - 1]);
        break;
      case "Home":
        focus(nodes[0]);
        break;
      case "End":
        focus(nodes.at(-1));
        break;
      case "ArrowRight":
        if (node.column) break;
        if (isOpen) focus(nodes[index + 1]?.column ? nodes[index + 1] : undefined);
        else toggle(node.table.name, true);
        break;
      case "ArrowLeft":
        if (node.column) focus(nodes.find((parent) => parent.key === node.table.name));
        else toggle(node.table.name, false);
        break;
      case "Enter":
        insert(node);
        break;
      case "p":
      case "P":
        if (node.column) return;
        profile(node.table);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const itemProps: ItemProps = (node) => ({
    tabIndex: node.key === tabStop ? 0 : -1,
    ref: (element) => {
      if (element) items.current.set(node.key, element);
      else items.current.delete(node.key);
    },
    // Focus events bubble, so a column taking focus mustn't make its table the Tab stop.
    onFocus: (event) => event.target === event.currentTarget && setActive(node.key),
    onClick: (event) => {
      event.stopPropagation();
      insert(node);
    },
    onKeyDown: (event) => onKeyDown(event, node),
  });

  return (
    <aside aria-labelledby="catalog-heading" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
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

      {catalog.tables.length === 0 && catalog.importing.length === 0 && (
        <p className="text-muted-foreground text-xs">
          No tables yet. Drop a CSV, Parquet or JSON file anywhere, or use Import files.
        </p>
      )}
      {catalog.tables.length > 0 && (
        <div
          role="tree"
          aria-labelledby="catalog-heading"
          className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-auto"
        >
          {catalog.tables.map((table) => (
            <TableItem
              key={table.name}
              table={table}
              expanded={expanded.has(table.name)}
              onToggle={() => toggle(table.name)}
              itemProps={itemProps}
            />
          ))}
        </div>
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
