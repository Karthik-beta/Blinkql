import {
  ArrowRightLeft,
  ChevronRight,
  Database,
  FileUp,
  Link,
  ScanSearch,
  Table2,
  Trash2,
} from "lucide-react";
import {
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { insertIntoEditor } from "@/features/editor/insert";
import { parseEngineError } from "@/features/results/engine-error";
import { runQuery } from "@/features/results/query-run";
import { loadSample, samples } from "@/features/samples/samples";
import {
  convertTable,
  filePath,
  forgetTable,
  getCatalog,
  type ImportedTable,
  importFiles,
  importUrl,
  isConvertible,
  profileSql,
  rowsSql,
  subscribeToCatalog,
  type TableColumn,
} from "./catalog";
import { type ColumnStats, loadColumnStats } from "./column-stats";
import { acceptedExtensions, type FileFormat, sqlName } from "./formats";
import { parseRemoteUrl } from "./remote";

const formatLabels: Readonly<Record<FileFormat, string>> = {
  csv: "CSV",
  parquet: "Parquet",
  json: "JSON",
  jsonl: "JSON lines",
  xlsx: "Excel",
};

const count = new Intl.NumberFormat();
const size = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** A size in bytes for people: 512 B, 1.5 KB, 12.4 MB. */
function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${size.format(value)} ${units[unit]}`;
}

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

function showRows(table: ImportedTable): void {
  void runQuery(rowsSql(table.name));
}

function forget(table: ImportedTable): void {
  void forgetTable(table.name);
}

function convert(table: ImportedTable): void {
  void convertTable(table.name);
}

function TableItem({
  table,
  expanded,
  converting,
  onToggle,
  itemProps,
}: {
  table: ImportedTable;
  expanded: boolean;
  converting: boolean;
  onToggle: () => void;
  itemProps: ItemProps;
}) {
  const labelId = useId();
  const sheetHintId = useId();
  const columns = table.columns.length;
  const convertible = isConvertible(table);
  const sheetHint = expanded && table.format === "xlsx";
  const { tabIndex, ...handlers } = itemProps({ key: table.name, table });
  return (
    <div
      role="treeitem"
      aria-expanded={expanded}
      aria-labelledby={labelId}
      aria-describedby={sheetHint ? sheetHintId : undefined}
      aria-keyshortcuts={convertible ? "C P R Delete" : "P R Delete"}
      className={itemClass}
      tabIndex={tabIndex}
      {...handlers}
    >
      <div className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-muted">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          title={expanded ? "Hide columns" : "Show columns and their statistics"}
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
          </div>{" "}
          {/* The space keeps the lines apart as text, so "name format" isn't read as one word. */}
          <div className="text-muted-foreground text-xs">
            {formatLabels[table.format]} · {columns} {columns === 1 ? "column" : "columns"}
            {table.source instanceof File && ` · ${formatSize(table.source.size)}`}
            {converting && " · Converting to Parquet…"}
          </div>
        </div>
        {/* Out of the Tab order, like the chevron: from the keyboard, C converts a CSV table to
            Parquet, R shows the rows, P profiles the table and Delete forgets it. Rows and
            profiles show in the results grid, like any query, so they need no SQL; the rows can
            then be charted. */}
        {convertible && (
          <Button
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            disabled={converting}
            aria-label={`Convert ${table.name} to Parquet`}
            title="Convert to Parquet (C): faster queries, and a smaller copy kept in this browser"
            onClick={(event) => {
              event.stopPropagation();
              convert(table);
            }}
          >
            <ArrowRightLeft aria-hidden />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          tabIndex={-1}
          aria-label={`Show rows of ${table.name}`}
          title="Show rows (R): every row, ready to chart"
          onClick={(event) => {
            event.stopPropagation();
            showRows(table);
          }}
        >
          <Table2 aria-hidden />
        </Button>
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
        <Button
          variant="ghost"
          size="icon-sm"
          tabIndex={-1}
          aria-label={`Forget ${table.name}`}
          title="Forget (Delete): remove the table and the copy kept in this browser"
          onClick={(event) => {
            event.stopPropagation();
            forget(table);
          }}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {/* The table is a workbook's first sheet; the others are only a query away. */}
      {sheetHint && (
        <p id={sheetHintId} className="pl-6 text-muted-foreground text-xs">
          First sheet only. For another, query{" "}
          <code className="wrap-anywhere font-mono">
            read_xlsx('{filePath(table)}', sheet = 'Sheet2')
          </code>
          .
        </p>
      )}
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
                  {count.format(columnStats.nullPercentage)}% null · {columnStats.exact ? "" : "~"}
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

/** A button that opens a dialog asking for the URL of a file on the web to read as a table. */
function AddUrlButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  const add = (event: FormEvent) => {
    event.preventDefault();
    try {
      const url = parseRemoteUrl(text);
      setOpen(false);
      setText("");
      void importUrl(url);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link data-icon="inline-start" aria-hidden />
        Add from URL
      </Button>
      <DialogContent>
        <DialogTitle>Add a file from a URL</DialogTitle>
        <DialogDescription>
          A CSV, Parquet or JSON file on a server that allows cross-origin requests. Only the parts
          a query needs are downloaded.
        </DialogDescription>
        <form noValidate className="flex flex-col gap-3" onSubmit={add}>
          <label className="flex flex-col gap-1">
            URL
            <input
              type="url"
              placeholder="https://example.com/data.parquet"
              className="h-7 rounded-md border bg-background px-2 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive"
              value={text}
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : errorId}
              onChange={(event) => {
                setText(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>
          {error !== null && (
            <p id={errorId} className="text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
            <Button type="submit" size="sm">
              Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens the list of sample datasets; picking one loads it as a table. */
function LoadSampleButton({
  ref,
  tables,
}: {
  ref: Ref<{ load(name: string): void }>;
  tables: readonly ImportedTable[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The dialog stays open while the sample is built, so a failure shows next to its cause.
  const load = async (name: string) => {
    setLoading(name);
    setError(null);
    try {
      await loadSample(name);
      setOpen(false);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? parseEngineError(problem, "", { preservePlainText: true }).message
          : String(problem),
      );
    } finally {
      setLoading(null);
    }
  };

  useImperativeHandle(ref, () => ({
    load(name) {
      setOpen(true);
      void load(name);
    },
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <Button variant="outline" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <Database data-icon="inline-start" aria-hidden />
        Load sample data
      </Button>
      <DialogContent>
        <DialogTitle>Load sample data</DialogTitle>
        <DialogDescription>
          A made-up factory's week and a quarter of its shipments, generated in this browser. Each
          sample becomes a table.
        </DialogDescription>
        <ul className="-mx-2 flex flex-col">
          {samples.map((sample) => {
            const loaded = tables.some((table) => table.name === sample.name);
            return (
              <li key={sample.name}>
                <button
                  type="button"
                  disabled={loaded || loading !== null}
                  className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left outline-ring hover:bg-muted focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-50"
                  onClick={() => void load(sample.name)}
                >
                  <span className="font-medium">
                    {sample.title}
                    {loaded && " (loaded)"}
                    {loading === sample.name && " (loading…)"}
                  </span>
                  <span className="text-muted-foreground">{sample.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {error !== null && (
          <p role="alert" className="text-destructive">
            Couldn't load the sample: {error}
          </p>
        )}
        <div className="flex justify-end">
          <DialogClose render={<Button variant="outline" size="sm" />}>Close</DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type CatalogHandle = {
  /** Opens the file picker, as Import files does. */
  importFiles(): void;
  /** Loads a sample, showing how it goes in the sample data dialog. */
  loadSample(name: string): void;
};

/**
 * The schema browser: a tree of tables and their columns (the ARIA tree pattern, one Tab stop),
 * with buttons that open the file picker, ask for a file's URL and load sample data. Clicking a
 * name, or pressing Enter on it, inserts it into the editor.
 */
export function CatalogPanel({ ref }: { ref?: Ref<CatalogHandle> }) {
  const catalog = useSyncExternalStore(subscribeToCatalog, getCatalog);
  const input = useRef<HTMLInputElement>(null);
  const sampleButton = useRef<{ load(name: string): void }>(null);
  useImperativeHandle(ref, () => ({
    importFiles: () => input.current?.click(),
    loadSample: (name) => sampleButton.current?.load(name),
  }));
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
      case "r":
      case "R":
        if (node.column) return;
        showRows(node.table);
        break;
      case "Delete":
        if (node.column) return;
        forget(node.table);
        break;
      case "c":
      case "C":
        if (node.column || !isConvertible(node.table)) return;
        convert(node.table);
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
        <div className="flex gap-1">
          <AddUrlButton />
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            <FileUp data-icon="inline-start" aria-hidden />
            Import files
          </Button>
        </div>
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
          No tables yet. Drop a CSV, Excel, Parquet or JSON file anywhere, use Import files, or load
          sample data to try things out.
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
              converting={catalog.converting.includes(table.name)}
              onToggle={() => toggle(table.name)}
              itemProps={itemProps}
            />
          ))}
        </div>
      )}
      <LoadSampleButton ref={sampleButton} tables={catalog.tables} />

      <div aria-live="polite" className="text-muted-foreground text-xs">
        {catalog.importing.length > 0 && <p>Importing {catalog.importing.join(", ")}…</p>}
        {catalog.storageUnavailable && (
          <p>This browser can't keep these files, so their tables will be gone after a reload.</p>
        )}
      </div>

      {catalog.failures.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-destructive text-xs">
          {catalog.failures.map((failure) => (
            <li key={failure.fileName}>
              {failure.during === "conversion"
                ? `Couldn't convert ${failure.fileName} to Parquet: `
                : `Couldn't import ${failure.fileName}: `}
              {failure.message}
            </li>
          ))}
        </ul>
      )}

      {catalog.warnings.length > 0 && (
        <ul role="status" className="flex flex-col gap-1 text-muted-foreground text-xs">
          {catalog.warnings.map((warning) => (
            <li key={warning.fileName}>
              {warning.fileName}: {warning.message}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
