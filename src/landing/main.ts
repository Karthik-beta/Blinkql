// The landing page's only script: it runs the hero replay and keeps the theme in step with the
// system setting. Everything else on the page is static HTML.
import "./landing.css";
import { createReplay } from "./replay.ts";
import { replayQuery } from "./replay-data.ts";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const replay = createReplay({
  root: document.body,
  status: document.querySelector<HTMLElement>("[data-replay-status]"),
  doneMessage: `Query finished, ${replayQuery.rowCount} rows in ${replayQuery.elapsedMs} ms`,
  reducedMotion: () => reducedMotion.matches,
});

replay.play();
document.querySelector("[data-replay]")?.addEventListener("click", () => {
  replay.play({ announce: true });
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
