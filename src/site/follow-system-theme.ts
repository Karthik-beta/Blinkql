// public/theme-init.js applies the theme before first paint; this follows later system changes on
// the site's static pages (the workbench has its own theme setting).
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
