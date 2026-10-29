// The onboarding tour: three steps that take a new user from sample data to a chart, each done
// for them by the step's button. It's a small panel in a corner rather than a dialog, so the
// workbench stays usable and the user can follow along or do a step themselves.
import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { type ChartPreset, setChartPreset } from "@/features/charts/chart-preset";
import { editorContents, focusEditor, replaceEditorContents } from "@/features/editor/insert";
import { getQueryRun, runQuery, subscribeToQueryRun } from "@/features/results/query-run";
import { getResult, subscribeToResult } from "@/features/results/result-store";
import { loadSample } from "@/features/samples/samples";
import {
  endTour,
  getTourStep,
  hasSeenTour,
  showTourStep,
  startTour,
  subscribeToTour,
  type TourStep,
} from "./tour-step";

/** The sample the tour loads: one row per hourly check, with a machine and a reject count. */
const SAMPLE = "quality_checks";

const STARTER_SQL = `SELECT machine_id, round(100 * sum(rejected) / sum(inspected), 2) AS reject_rate_pct
FROM ${SAMPLE}
GROUP BY machine_id
ORDER BY reject_rate_pct DESC`;

/** The starter query's chart, as the "Reject rate by machine" template draws it. */
const CHART: Omit<ChartPreset, "sql"> = {
  type: "bar",
  x: "machine_id",
  y: "reject_rate_pct",
  aggregate: "avg",
};

const steps: Record<
  TourStep,
  { number: number; title: string; text: string; action: string; busy?: string }
> = {
  load: {
    number: 1,
    title: "Load sample data",
    text: "Blinkql comes with sample data from a made-up factory. Start with its quality checks.",
    action: "Load quality checks",
    busy: "Loading…",
  },
  run: {
    number: 2,
    title: "Run a query",
    text: "The editor now holds a query for each machine's reject rate. Run it here, or with Run above the editor.",
    action: "Run the query",
    busy: "Running…",
  },
  chart: {
    number: 3,
    title: "See it as a chart",
    text: "Show the result as a bar chart of reject rate by machine.",
    action: "Show as a chart",
  },
  done: {
    number: 3,
    title: "See it as a chart",
    text: "Change it with the chart settings above it, or try a ready-made analysis from Templates.",
    action: "Done",
  },
};
const STEP_COUNT = 3;

/** Ends the tour and gives the focus to the editor, where the user carries on. */
function finish(): void {
  endTour();
  focusEditor();
}

function TourPanel({ step }: { step: TourStep }) {
  const { number, title, text, action, busy } = steps[step];
  const primary = useRef<HTMLButtonElement>(null);
  const run = useSyncExternalStore(subscribeToQueryRun, getQueryRun);
  // The run when this step opened: the "run" step waits for the next one to finish.
  const startRun = useRef(run).current;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const newRun = run !== startRun;

  // Each step opens with the focus on its button, so keyboard users can carry straight on.
  useEffect(() => primary.current?.focus(), []);

  useEffect(() => {
    if (step === "run" && newRun && run.state === "done") showTourStep("chart");
  }, [step, newRun, run]);

  const working = (step === "load" && loading) || (step === "run" && run.state === "running");
  const error =
    step === "load"
      ? loadError
      : step === "run" && newRun && run.state === "failed"
        ? "The query didn't run. Fix it in the editor using the error below it, then run it again."
        : null;

  const perform = async () => {
    switch (step) {
      case "load":
        setLoading(true);
        setLoadError(null);
        try {
          // Waits for the engine if it's still starting.
          await loadSample(SAMPLE);
          replaceEditorContents(STARTER_SQL);
          showTourStep("run");
        } catch (cause) {
          setLoadError(
            `Couldn't load the sample: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
          setLoading(false);
        }
        return;
      case "run":
        void runQuery(editorContents());
        return;
      case "chart": {
        const last = getQueryRun();
        setChartPreset({ sql: last.state === "idle" ? STARTER_SQL : last.sql, ...CHART });
        showTourStep("done");
        return;
      }
      case "done":
        finish();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // Handled here, so it doesn't also cancel a running query (QueryPanel.tsx).
    event.preventDefault();
    finish();
  };

  return (
    <section
      aria-label="Tour"
      onKeyDown={onKeyDown}
      // Above the status bar, clear of the editor's Run button and the results bar.
      className="fixed right-3 bottom-9 z-40 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2 rounded-xl border bg-popover p-3 text-popover-foreground text-xs shadow-lg"
    >
      <p className="text-muted-foreground">
        Step {number} of {STEP_COUNT}
      </p>
      <h2 className="font-medium text-sm">{title}</h2>
      <p>{text}</p>
      {error !== null && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {step !== "done" && (
          <Button variant="ghost" size="sm" onClick={finish}>
            {step === "load" ? "Skip tour" : "End tour"}
          </Button>
        )}
        <Button
          ref={primary}
          size="sm"
          // Stays focusable while it works, so keyboard focus isn't lost.
          focusableWhenDisabled
          disabled={working}
          onClick={() => void perform()}
        >
          {working ? busy : action}
        </Button>
      </div>
    </section>
  );
}

/**
 * The tour's panel while it's open, and the polite announcement of each step for screen readers,
 * which is on the page all along so that each change to it is read out.
 */
export function Tour() {
  const step = useSyncExternalStore(subscribeToTour, getTourStep);
  const current = step && steps[step];
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {current && `Step ${current.number} of ${STEP_COUNT}: ${current.title}. ${current.text}`}
      </p>
      {step && <TourPanel key={step} step={step} />}
    </>
  );
}

const nothingRun = () => getQueryRun().state === "idle";
const noResult = () => getResult() === null;

/**
 * Offers the tour in the empty results area until the user has run a query or been through the
 * tour once. It can still be started after that, with startTour().
 */
export function TourInvite() {
  const step = useSyncExternalStore(subscribeToTour, getTourStep);
  const seen = useSyncExternalStore(subscribeToTour, hasSeenTour);
  const idle = useSyncExternalStore(subscribeToQueryRun, nothingRun);
  const empty = useSyncExternalStore(subscribeToResult, noResult);
  if (step !== null || seen || !idle || !empty) return null;
  return (
    // Centred over the empty results without taking the clicks around it.
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div className="pointer-events-auto flex max-w-xs flex-col items-center gap-2 text-center text-muted-foreground text-xs">
        <p>New here? A three-step tour loads sample data, runs a query on it and charts it.</p>
        <Button variant="outline" size="sm" onClick={startTour}>
          Take the tour
        </Button>
      </div>
    </div>
  );
}
