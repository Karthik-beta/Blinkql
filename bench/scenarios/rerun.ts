// How long a person waits for a query they run while another is still running (P-06). Until P-06
// the workbench ignored a run while one was in progress, so the person had to wait for the slow
// query to finish and run theirs again; since P-06 the new query cancels the slow one. No dataset
// is needed: the slow query computes its own rows.
import type { Page } from "@playwright/test";
import { openWorkbench } from "../harness/page.ts";
import type { Scenario } from "../harness/types.ts";

/** Takes a few seconds in the engine, and streams, so DuckDB can stop it part way. */
const SLOW_QUERY = "SELECT sum(hash(range)) AS total FROM range(150000000)";
/** The query run while the slow one is in progress; its one value tells its result apart. */
const NEXT_QUERY = "SELECT 42 AS answer";

async function typeSql(page: Page, sql: string): Promise<void> {
  await page.getByRole("textbox", { name: "SQL editor" }).click();
  await page.keyboard.press("ControlOrMeta+A");
  // insertText, not type: the editor's bracket and quote auto-closing would mangle typed SQL.
  await page.keyboard.insertText(sql);
}

/**
 * Waits until the next query's row is on screen, returning the time it showed, or until no query
 * is running any more, returning null: the run was ignored and has to be repeated.
 */
async function nextResultOrIdle(page: Page): Promise<number | null> {
  const outcome = await page.waitForFunction(
    () => {
      const cell = document.querySelector('[role="grid"] [role="gridcell"]');
      if (cell?.textContent === "42") return { at: performance.now() };
      const buttons = [...document.querySelectorAll("button")];
      const running = buttons.some((button) => button.textContent?.startsWith("Running"));
      return running ? null : { at: null };
    },
    undefined,
    { timeout: 120_000, polling: "raf" },
  );
  return ((await outcome.jsonValue()) as { at: number | null }).at;
}

export const rerun: Scenario = {
  name: "rerun-while-running",
  description: `Run "${NEXT_QUERY}" while "${SLOW_QUERY}" is running, through the UI.`,
  modes: ["warm"],
  metrics: { rerunMs: "ms", attempts: "count" },
  async run(page, baseURL) {
    await openWorkbench(page, baseURL);
    await typeSql(page, SLOW_QUERY);
    await page.keyboard.press("ControlOrMeta+Enter");
    // While a query runs, the Run button reads "Running" and the time so far.
    await page.getByRole("button", { name: /^Running/ }).waitFor();

    await typeSql(page, NEXT_QUERY);
    const pressedAt = await page.evaluate(() => performance.now());
    let attempts = 0;
    while (true) {
      attempts++;
      await page.keyboard.press("ControlOrMeta+Enter");
      const shownAt = await nextResultOrIdle(page);
      if (shownAt !== null) return { rerunMs: shownAt - pressedAt, attempts };
    }
  },
};
