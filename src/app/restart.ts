import { restartEngine } from "@/engine/engine";
import { reimportTables } from "@/features/catalog/catalog";
import { resetQueryRun } from "@/features/results/query-run";

let restarting: Promise<void> | null = null;

/**
 * Starts a fresh engine and imports the user's files into it again, so their tables come back.
 * If the engine fails to start, the status bar says so and offers another try, and the catalog is
 * left as it was; this never rejects.
 */
export function restart(): Promise<void> {
  restarting ??= (async () => {
    try {
      resetQueryRun();
      await restartEngine();
      await reimportTables();
    } catch {
      // The engine's status reports the failure.
    } finally {
      restarting = null;
    }
  })();
  return restarting;
}
