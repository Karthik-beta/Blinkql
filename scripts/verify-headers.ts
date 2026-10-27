// Fails if a deployment is missing any header vercel.json gives a page, or a hashed file under
// /assets/ (the immutable Cache-Control that lets a returning visitor start the engine from cache).
//
//   node scripts/verify-headers.ts --build-output .vercel/output   (after `vercel build`)
//   node scripts/verify-headers.ts --url https://blinkql.vercel.app (a live, public URL)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { headersFor } from "./headers.ts";

type Route = { src?: string; headers?: Record<string, string> };
type Checked = { path: string; actual: Map<string, string> };

function lowerCaseKeys(headers: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

/** Headers the build output's routes (Build Output API v3) give a page and a hashed file. */
function fromBuildOutput(dir: string): Checked[] {
  const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
    routes?: Route[];
  };
  return ["/", "/assets/index-0123abcd.js"].map((path) => {
    const merged: Record<string, string> = {};
    for (const route of config.routes ?? []) {
      if (route.src && new RegExp(route.src).test(path)) Object.assign(merged, route.headers);
    }
    return { path, actual: lowerCaseKeys(merged) };
  });
}

async function fetchHeaders(url: URL): Promise<{ checked: Checked; body: string }> {
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} answered ${response.status}, expected 200`);
  }
  const actual = lowerCaseKeys(Object.fromEntries(response.headers));
  return { checked: { path: url.pathname, actual }, body: await response.text() };
}

/** Headers on the page at `url` and on the first hashed file it references. */
async function fromUrl(url: string): Promise<Checked[]> {
  const page = await fetchHeaders(new URL(url));
  const asset = page.body.match(/["'](\/assets\/[^"']+)["']/)?.[1];
  if (!asset) throw new Error(`${url} references no file under /assets/`);
  const file = await fetchHeaders(new URL(asset, url));
  return [page.checked, file.checked];
}

const { values } = parseArgs({
  options: { "build-output": { type: "string" }, url: { type: "string" } },
});
const target = values.url ?? values["build-output"];
if (!target) {
  console.error("Usage: verify-headers.ts --build-output <dir> | --url <url>");
  process.exit(2);
}

const checked = values.url ? await fromUrl(values.url) : fromBuildOutput(target);
const problems = checked.flatMap(({ path, actual }) =>
  Object.entries(headersFor(path)).flatMap(([key, expected]) => {
    const value = actual.get(key.toLowerCase());
    if (value === undefined) return [`${path}: missing ${key}`];
    if (value !== expected) return [`${path}: ${key} is "${value}", expected "${expected}"`];
    return [];
  }),
);

if (problems.length > 0) {
  console.error(`Header check failed for ${target}:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
const count = checked.reduce((sum, { path }) => sum + Object.keys(headersFor(path)).length, 0);
process.stdout.write(
  `All ${count} headers present on ${target} (${checked.map(({ path }) => path).join(", ")})\n`,
);
