// Response headers come from one place: the "/(.*)" rule in vercel.json.
// Vite's dev and preview servers, and the header checks, all read them from here.
import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import vercel from "../vercel.json" with { type: "json" };

const rule = vercel.headers.find((r) => r.source === "/(.*)");
if (!rule) throw new Error('vercel.json has no headers rule for "/(.*)"');

/** Headers Vercel sends on every response. */
export const responseHeaders: Readonly<Record<string, string>> = Object.fromEntries(
  rule.headers.map(({ key, value }) => [key, value]),
);

/**
 * The same headers without the Content Security Policy. Vite's dev server relies on inline
 * scripts and injected <style> tags for hot reload, which the production CSP blocks.
 */
export const devServerHeaders: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(responseHeaders).filter(([key]) => key !== "Content-Security-Policy"),
);

/**
 * Sends the headers on every response from Vite's dev and preview servers. Their `headers` option
 * leaves them off 304 Not Modified responses, and WebKit then refuses a revalidated worker script
 * under Cross-Origin-Embedder-Policy, so a second engine (a restart) couldn't start.
 */
export function headersOnEveryResponse(): Plugin {
  const setAll =
    (headers: Readonly<Record<string, string>>) =>
    (_request: unknown, response: ServerResponse, next: () => void) => {
      for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
      next();
    };
  return {
    name: "blinkql:headers-on-every-response",
    configureServer(server) {
      server.middlewares.use(setAll(devServerHeaders));
    },
    configurePreviewServer(server) {
      server.middlewares.use(setAll(responseHeaders));
    },
  };
}
