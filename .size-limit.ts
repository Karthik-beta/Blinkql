// Bundle budgets, checked by `pnpm size` after `pnpm build` and in CI. Each check is the gzipped
// JavaScript a page loads before it can run, read from its built HTML, so new chunk names need no
// change here. Code a page imports later, and DuckDB's WebAssembly and worker, aren't counted.
import { readFileSync } from "node:fs";
import { initialScripts } from "./scripts/initial-scripts.ts";

function initialJavaScript(page: string): string[] {
  const html = `dist/${page}index.html`;
  let source: string;
  try {
    source = readFileSync(html, "utf8");
  } catch {
    throw new Error(`${html} not found; run \`pnpm build\` first`);
  }
  return initialScripts(source).map((url) => `dist${url}`);
}

export default [
  {
    name: "Workbench (/app/): initial JavaScript",
    path: initialJavaScript("app/"),
    gzip: true,
    limit: "250 kB",
  },
  {
    // No React: a theme script and a few small modules.
    name: "Landing page (/): initial JavaScript",
    path: initialJavaScript(""),
    gzip: true,
    limit: "5 kB",
  },
];
