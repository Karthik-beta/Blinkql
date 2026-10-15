// Fails if a deployment is missing any header from vercel.json's "/(.*)" rule.
//
//   node scripts/verify-headers.ts --build-output .vercel/output   (after `vercel build`)
//   node scripts/verify-headers.ts --url https://blinkql.vercel.app (a live, public URL)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { responseHeaders } from "./headers.ts";

type Route = { src?: string; headers?: Record<string, string> };

function lowerCaseKeys(headers: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

/** Headers configured on the build output's routes (Build Output API v3). */
function fromBuildOutput(dir: string): Map<string, string> {
  const config = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
    routes?: Route[];
  };
  const merged: Record<string, string> = {};
  for (const route of config.routes ?? []) Object.assign(merged, route.headers);
  return lowerCaseKeys(merged);
}

async function fromUrl(url: string): Promise<Map<string, string>> {
  const response = await fetch(url, { redirect: "manual" });
  if (response.status !== 200) {
    throw new Error(`${url} answered ${response.status}, expected 200`);
  }
  return lowerCaseKeys(Object.fromEntries(response.headers));
}

const { values } = parseArgs({
  options: { "build-output": { type: "string" }, url: { type: "string" } },
});
const target = values.url ?? values["build-output"];
if (!target) {
  console.error("Usage: verify-headers.ts --build-output <dir> | --url <url>");
  process.exit(2);
}

const actual = values.url ? await fromUrl(values.url) : fromBuildOutput(target);
const problems = Object.entries(responseHeaders).flatMap(([key, expected]) => {
  const value = actual.get(key.toLowerCase());
  if (value === undefined) return [`missing ${key}`];
  if (value !== expected) return [`${key} is "${value}", expected "${expected}"`];
  return [];
});

if (problems.length > 0) {
  console.error(`Header check failed for ${target}:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
process.stdout.write(`All ${Object.keys(responseHeaders).length} headers present on ${target}\n`);
