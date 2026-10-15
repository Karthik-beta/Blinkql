// Where a result came from: commit, machine and browser. Saved with every result file.
import { execFileSync } from "node:child_process";
import { arch, availableParallelism, cpus, platform, release, totalmem } from "node:os";
import type { Browser } from "@playwright/test";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function describeCommit() {
  return {
    sha: git("rev-parse", "HEAD"),
    /** Tracked files had uncommitted changes, so the SHA alone doesn't reproduce the run. */
    dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
  };
}

export function describeEnvironment(browser: Browser) {
  return {
    os: { platform: platform(), release: release(), arch: arch() },
    cpu: { model: cpus()[0]?.model.trim() ?? "unknown", cores: availableParallelism() },
    memoryBytes: totalmem(),
    node: process.version,
    // Playwright pins the browser build, so its version follows @playwright/test in the lockfile.
    browser: { name: browser.browserType().name(), version: browser.version() },
    ci: Boolean(process.env.CI),
  };
}
