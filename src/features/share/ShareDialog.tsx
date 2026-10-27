// The "Share" button, the dialog with the link it makes, and the opening of such links. A link
// holds the last query and the chart on screen, never data, so whoever opens it runs the query on
// their own files.
import { Copy, Share2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { setChartPreset } from "@/features/charts/chart-preset";
import { getShownChart } from "@/features/charts/chart-settings";
import { replaceEditorContents } from "@/features/editor/insert";
import { getQueryRun, type QueryRun, subscribeToQueryRun } from "@/features/results/query-run";
import { literalValues } from "./literals";
import { decodeShareLink, encodeShareLink, SHARE_PREFIX } from "./share-link";

/** The most literal values the warning lists; a query full of them would fill the dialog. */
const MAX_LISTED = 10;

/** The page's address without its fragment. */
function pageAddress(): string {
  return location.href.slice(0, location.href.length - location.hash.length);
}

/**
 * Opens the share link in the page's address, if there is one: its query goes into the editor and
 * its chart becomes the preset for that query. The query isn't run, since the tables it reads may
 * not be loaded yet. Returns what to tell the user, or null when there's no share link.
 */
function openSharedQuery(): string | null {
  if (!location.hash.startsWith(SHARE_PREFIX)) return null;
  const shared = decodeShareLink(location.hash);
  // Without the fragment, reloading the page doesn't open the query again over later edits.
  history.replaceState(history.state, "", pageAddress());
  if (!shared) return "That share link couldn't be read, so nothing was opened.";
  replaceEditorContents(shared.sql);
  setChartPreset(shared.chart ? { sql: shared.sql, ...shared.chart } : null);
  return "Opened a shared query. Run it once its data is loaded.";
}

function ShareContent({ sql }: { sql: string }) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  // Read once: the dialog covers the chart, so its settings can't change while it's open.
  const [link] = useState(() => {
    const chart = getShownChart();
    return pageAddress() + encodeShareLink(chart ? { sql, chart } : { sql });
  });
  const [copied, setCopied] = useState<string | null>(null);
  const literals = literalValues(sql);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("Link copied");
    } catch {
      field.current?.select();
      setCopied("Couldn't copy. The link is selected; copy it from there.");
    }
  };

  return (
    <>
      <DialogTitle>Share query</DialogTitle>
      <DialogDescription>
        The link holds the query and chart settings, but no data. Whoever opens it runs the query on
        their own files.
      </DialogDescription>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-link`}>Link</label>
        <div className="flex gap-2">
          <input
            ref={field}
            id={`${id}-link`}
            readOnly
            value={link}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button size="sm" onClick={() => void copy()}>
            <Copy data-icon="inline-start" aria-hidden />
            Copy link
          </Button>
        </div>
        <p aria-live="polite" className="min-h-4 text-muted-foreground">
          {copied}
        </p>
      </div>
      {literals.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md bg-warning p-3 text-warning-foreground">
          <p className="flex items-start gap-1.5 font-medium">
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            The query has values written into it, which anyone with the link can read:
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 pl-5">
            {literals.slice(0, MAX_LISTED).map((value) => (
              <li key={value}>
                <code className="font-mono">{value}</code>
              </li>
            ))}
          </ul>
          {literals.length > MAX_LISTED && (
            <p className="pl-5">and {literals.length - MAX_LISTED} more.</p>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <DialogClose render={<Button variant="outline" size="sm" />}>Close</DialogClose>
      </div>
    </>
  );
}

/** The "Share" button and its dialog; also opens a share link the page was loaded with. */
export function ShareDialog() {
  const run = useSyncExternalStore(subscribeToQueryRun, getQueryRun);
  const [open, setOpen] = useState(false);
  // Shown until the next query runs, which makes it out of date.
  const [notice, setNotice] = useState<{ message: string; run: QueryRun } | null>(null);
  const sql = run.state === "done" ? run.sql : null;

  useEffect(() => {
    const message = openSharedQuery();
    // Strict Mode runs this twice; the second time, the fragment is already gone.
    if (message) setNotice({ message, run: getQueryRun() });
  }, []);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <span aria-live="polite" className="min-w-0 truncate text-muted-foreground text-xs">
        {notice?.run === run && notice.message}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <Button variant="ghost" size="sm" disabled={!sql} onClick={() => setOpen(true)}>
          <Share2 data-icon="inline-start" aria-hidden />
          Share
        </Button>
        <DialogContent className="max-w-lg">{sql && <ShareContent sql={sql} />}</DialogContent>
      </Dialog>
    </div>
  );
}
