import { Copy, FolderOpen, Pencil, Play, Save, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { editorContents, replaceEditorContents } from "@/features/editor/insert";
import { formatDuration, formatRows } from "@/features/results/format";
import { runQuery } from "@/features/results/query-run";
import {
  deleteSavedQuery,
  filterHistory,
  getHistory,
  type HistoryEntry,
  renameSavedQuery,
  type SavedQuery,
  saveQuery,
  subscribeToHistory,
} from "./history";

const time = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

const inputClass =
  "h-6 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

/** Puts `sql` in the editor and runs it, so the editor shows what ran. */
function openAndRun(sql: string): void {
  replaceEditorContents(sql);
  void runQuery(sql, 0);
}

function Outcome({ entry }: { entry: HistoryEntry }) {
  const duration = formatDuration(entry.durationMs);
  switch (entry.outcome) {
    case "done":
      return (
        <span>
          {formatRows(entry.rowCount ?? 0)} · {duration}
        </span>
      );
    case "cancelled":
      return <span>Cancelled · {duration}</span>;
    case "failed":
      return <span className="text-destructive">{entry.error}</span>;
  }
}

function HistoryList({ onCopied }: { onCopied: (message: string) => void }) {
  const { history, loaded } = useSyncExternalStore(subscribeToHistory, getHistory);
  const [search, setSearch] = useState("");
  const id = useId();
  const shown = filterHistory(history, search);

  const copy = (sql: string) =>
    navigator.clipboard.writeText(sql).then(
      () => onCopied("Copied to the clipboard."),
      () => onCopied("Couldn't copy to the clipboard."),
    );

  return (
    <>
      <input
        type="search"
        aria-label="Search history"
        placeholder="Search history"
        className={`${inputClass} flex-none`}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
      />
      {loaded && shown.length === 0 && (
        <p className="text-muted-foreground text-xs">
          {history.length === 0 ? "Queries you run show up here." : "No matching queries."}
        </p>
      )}
      <ul aria-label="Query history" className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-auto">
        {shown.map((entry) => (
          <li key={entry.id} className="flex items-start gap-1 rounded-md px-1 py-1 hover:bg-muted">
            <div className="flex min-w-0 flex-1 flex-col">
              <code
                id={`${id}-${entry.id}`}
                className="truncate font-mono text-xs"
                title={entry.sql}
              >
                {entry.sql}
              </code>
              <span className="truncate text-muted-foreground text-xs tabular-nums">
                <time dateTime={new Date(entry.ranAt).toISOString()}>
                  {time.format(entry.ranAt)}
                </time>{" "}
                · <Outcome entry={entry} />
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Run again"
              // Every past run has these buttons; its SQL tells screen reader users which is which.
              aria-describedby={`${id}-${entry.id}`}
              title="Run again"
              onClick={() => openAndRun(entry.sql)}
            >
              <Play aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy SQL"
              aria-describedby={`${id}-${entry.id}`}
              title="Copy SQL"
              onClick={() => void copy(entry.sql)}
            >
              <Copy aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

function SavedItem({ query }: { query: SavedQuery }) {
  const [renaming, setRenaming] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);

  const finished = useRef(false);
  // Back to Rename once the name field is gone, so keyboard focus isn't lost.
  useEffect(() => {
    if (!renaming && finished.current) renameButton.current?.focus();
  }, [renaming]);

  const finishRename = (name?: string) => {
    if (name !== undefined) void renameSavedQuery(query.id, name);
    finished.current = true;
    setRenaming(false);
  };

  return (
    <li className="flex flex-col gap-0.5 rounded-md px-1 py-1 hover:bg-muted">
      {renaming ? (
        <form
          className="flex"
          onSubmit={(event) => {
            event.preventDefault();
            finishRename(new FormData(event.currentTarget).get("name")?.toString());
          }}
        >
          <input
            name="name"
            aria-label={`New name for ${query.name}`}
            defaultValue={query.name}
            // biome-ignore lint/a11y/noAutofocus: the user just asked to rename this query
            autoFocus
            className={inputClass}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              finishRename();
            }}
          />
        </form>
      ) : (
        <span className="truncate font-medium text-xs">{query.name}</span>
      )}
      <code className="truncate font-mono text-muted-foreground text-xs" title={query.sql}>
        {query.sql}
      </code>
      <div className="flex gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Open ${query.name}`}
          title="Open in the editor"
          onClick={() => replaceEditorContents(query.sql)}
        >
          <FolderOpen aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Run ${query.name}`}
          title="Run"
          onClick={() => openAndRun(query.sql)}
        >
          <Play aria-hidden />
        </Button>
        <Button
          ref={renameButton}
          variant="ghost"
          size="icon-sm"
          aria-label={`Rename ${query.name}`}
          title="Rename"
          onClick={() => setRenaming(true)}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${query.name}`}
          title="Delete"
          onClick={() => void deleteSavedQuery(query.id)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}

function SavedList({ onMessage }: { onMessage: (message: string) => void }) {
  const { saved, loaded } = useSyncExternalStore(subscribeToHistory, getHistory);
  const [name, setName] = useState("");

  const save = (event: FormEvent) => {
    event.preventDefault();
    const sql = editorContents();
    if (!sql.trim()) return onMessage("Write some SQL to save first.");
    if (!name.trim()) return onMessage("Give the query a name to save it.");
    void saveQuery(name, sql);
    setName("");
    onMessage(`Saved ${name.trim()}.`);
  };

  return (
    <>
      <form className="flex gap-1" onSubmit={save}>
        <input
          aria-label="Name"
          placeholder="Name"
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Button type="submit" variant="outline" size="sm" title="Save the editor's SQL">
          <Save data-icon="inline-start" aria-hidden />
          Save
        </Button>
      </form>
      {loaded && saved.length === 0 && (
        <p className="text-muted-foreground text-xs">No saved queries yet.</p>
      )}
      <ul aria-label="Saved queries" className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-auto">
        {saved.map((query) => (
          <SavedItem key={query.id} query={query} />
        ))}
      </ul>
    </>
  );
}

/** Past runs, to search, run again and copy, and saved queries, to open, run, rename and delete. */
export function HistoryPanel() {
  const [view, setView] = useState<"history" | "saved">("history");
  const [message, setMessage] = useState("");

  return (
    <section aria-label="Queries" className="flex min-h-0 flex-1 flex-col gap-2 border-t p-3">
      <fieldset aria-label="Queries view" className="flex gap-1">
        <Button
          variant={view === "history" ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={view === "history"}
          onClick={() => setView("history")}
        >
          History
        </Button>
        <Button
          variant={view === "saved" ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={view === "saved"}
          onClick={() => setView("saved")}
        >
          Saved
        </Button>
      </fieldset>
      {view === "history" ? (
        <HistoryList onCopied={setMessage} />
      ) : (
        <SavedList onMessage={setMessage} />
      )}
      <p aria-live="polite" className="text-muted-foreground text-xs empty:hidden">
        {message}
      </p>
    </section>
  );
}
