// The landing page's only script: it runs the hero's sample query live when asked, and keeps the
// theme in step with the system setting. Everything else on the page is static HTML.
import "./landing.css";
import { createLiveRun } from "./live-run.ts";

// The engine loads only on request, so it costs the page's first load nothing.
const sample = () => import("./sample-run.ts");

const grid = document.querySelector<HTMLElement>("[data-grid]");
const rowCount = document.querySelector<HTMLElement>("[data-row-count]");
const elapsed = document.querySelector<HTMLElement>("[data-elapsed-ms]");

const liveRun = createLiveRun({
  root: document.body,
  status: document.querySelector<HTMLElement>("[data-run-status]"),
  prepare: async () => (await sample()).prepare(),
  execute: async () => (await sample()).execute(),
  show: (result) => {
    if (grid) grid.innerHTML = result.gridHtml;
    if (rowCount) rowCount.textContent = String(result.rowCount);
    if (elapsed) elapsed.textContent = String(result.elapsedMs);
  },
});

document.querySelector("[data-run-live]")?.addEventListener("click", () => {
  void liveRun.start();
});

// public/theme-init.js applies the theme before first paint; this follows later system changes.
const dark = matchMedia("(prefers-color-scheme: dark)");
dark.addEventListener("change", () => {
  let choice = "system";
  try {
    choice = localStorage.getItem("blinkql-theme") ?? "system";
  } catch {
    // Storage can be blocked; follow the system.
  }
  if (choice === "system") document.documentElement.classList.toggle("dark", dark.matches);
});
