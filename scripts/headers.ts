// Response headers come from one place: the headers rules in vercel.json.
// Vite's dev and preview servers, and the header checks, all read them from here.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import vercel from "../vercel.json" with { type: "json" };

const rule = vercel.headers.find((r) => r.source === "/(.*)");
if (!rule) throw new Error('vercel.json has no headers rule for "/(.*)"');

/** Headers Vercel sends on every response. */
export const responseHeaders: Readonly<Record<string, string>> = Object.fromEntries(
  rule.headers.map(({ key, value }) => [key, value]),
);

// Each rule's source is a path pattern whose only special part is a "(.*)" group, which reads the
// same as a regular expression.
const rules = vercel.headers.map(({ source, headers }) => ({
  matches: new RegExp(`^${source}$`),
  headers: Object.fromEntries(headers.map(({ key, value }) => [key, value])),
}));

/**
 * Headers Vercel sends on a response for `path`: those of every rule in vercel.json that matches
 * it, later rules winning, such as the immutable Cache-Control on hashed files under /assets/.
 */
export function headersFor(path: string): Readonly<Record<string, string>> {
  return Object.assign({}, ...rules.filter((r) => r.matches.test(path)).map((r) => r.headers));
}

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
 *
 * The preview server sends each path's headers from every matching rule, so the engine's hashed
 * files are cached as immutable there too, instead of Vite's "no-cache", and benchmarks of a warm
 * start see what production users get.
 */
export function headersOnEveryResponse(): Plugin {
  const setAll =
    (headers: (path: string) => Readonly<Record<string, string>>) =>
    (request: IncomingMessage, response: ServerResponse, next: () => void) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      for (const [key, value] of Object.entries(headers(path))) response.setHeader(key, value);
      next();
    };
  return {
    name: "blinkql:headers-on-every-response",
    configureServer(server) {
      server.middlewares.use(setAll(() => devServerHeaders));
    },
    configurePreviewServer(server) {
      server.middlewares.use(setAll(headersFor));
    },
  };
}
