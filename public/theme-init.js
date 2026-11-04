// Applies the saved theme before first paint so dark-mode users never see a white flash.
// Loaded as a same-origin file (not inline) to keep the Content Security Policy strict.
// The "js" class lets CSS tell that scripts run (the landing page's live run depends on it).
document.documentElement.classList.add("js");
try {
  const choice = localStorage.getItem("blinkql-theme") ?? "system";
  const dark =
    choice === "dark" ||
    (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
} catch {
  // Storage can be blocked (private windows, strict settings). Fall back to light.
}
