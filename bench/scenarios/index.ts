import type { Scenario } from "../harness/types.ts";
import { chartLineScenarios } from "./chart-line.ts";
import { datasetScenarios } from "./datasets.ts";
import { firstRowsScenarios } from "./first-rows.ts";
import { rerun } from "./rerun.ts";
import { scrollScenarios } from "./scroll.ts";
import { timeToAppShell } from "./time-to-app-shell.ts";
import { timeToEngineReady } from "./time-to-engine-ready.ts";

/** Every scenario `pnpm bench` knows about, in the order they run. */
export const scenarios: readonly Scenario[] = [
  timeToAppShell,
  timeToEngineReady,
  ...datasetScenarios,
  ...scrollScenarios,
  ...firstRowsScenarios,
  rerun,
  ...chartLineScenarios,
];
