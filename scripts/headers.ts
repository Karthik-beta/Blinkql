// Response headers come from one place: the "/(.*)" rule in vercel.json.
// Vite's dev and preview servers, and the header checks, all read them from here.
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
