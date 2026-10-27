// Links that share a query and its chart settings, never its data. Everything is in the URL's
// fragment, which browsers don't send to the server: `#share=<version>.<base64url of the JSON>`.
import type { ChartSettings } from "@/features/charts/chart-settings";
import type { Aggregate, ChartType } from "@/features/charts/chart-sql";

export type SharePayload = { sql: string; chart?: ChartSettings };

/** How a share link's fragment starts. */
export const SHARE_PREFIX = "#share=";
/** The link format's version; a link of another version isn't read. */
const VERSION = "1";

const CHART_TYPES: readonly string[] = [
  "bar",
  "line",
  "scatter",
  "histogram",
  "pareto",
] satisfies ChartType[];
const AGGREGATES: readonly string[] = ["count", "sum", "avg", "min", "max"] satisfies Aggregate[];

function toBase64url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Throws if `encoded` isn't base64url of UTF-8 text. */
function fromBase64url(encoded: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) throw new Error("Not base64url");
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** The fragment of a link that shares `payload`, `#` included. */
export function encodeShareLink(payload: SharePayload): string {
  return `${SHARE_PREFIX}${VERSION}.${toBase64url(JSON.stringify(payload))}`;
}

const isString = (value: unknown): value is string => typeof value === "string";

function readChart(value: unknown): ChartSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const { type, x, y, aggregate } = value as Record<string, unknown>;
  if (!isString(type) || !CHART_TYPES.includes(type) || !isString(x)) return null;
  if (y !== undefined && !isString(y)) return null;
  if (aggregate !== undefined && !(isString(aggregate) && AGGREGATES.includes(aggregate))) {
    return null;
  }
  return {
    type: type as ChartType,
    x,
    ...(y !== undefined && { y }),
    ...(aggregate !== undefined && { aggregate: aggregate as Aggregate }),
  };
}

/**
 * What a link's fragment (`location.hash`) shares, or null if it isn't a share link of this
 * version or can't be read. Fields it doesn't know are dropped.
 */
export function decodeShareLink(hash: string): SharePayload | null {
  if (!hash.startsWith(`${SHARE_PREFIX}${VERSION}.`)) return null;
  let value: unknown;
  try {
    value = JSON.parse(fromBase64url(hash.slice(SHARE_PREFIX.length + VERSION.length + 1)));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { sql, chart } = value as Record<string, unknown>;
  if (!isString(sql) || !sql.trim()) return null;
  if (chart === undefined) return { sql };
  const settings = readChart(chart);
  return settings && { sql, chart: settings };
}
