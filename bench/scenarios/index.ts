import type { Scenario } from "../harness/types.ts";
import { timeToAppShell } from "./time-to-app-shell.ts";
import { timeToEngineReady } from "./time-to-engine-ready.ts";

/** Every scenario `pnpm bench` knows about, in the order they run. */
export const scenarios: readonly Scenario[] = [timeToAppShell, timeToEngineReady];
