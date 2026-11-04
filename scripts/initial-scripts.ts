// The JavaScript a built page loads before it can run, for the bundle budgets in .size-limit.ts.

const TAG = /<(script|link)\b([^>]*)>/gi;
const ATTRIBUTE = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attributes(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name = "", double, single, bare] of source.matchAll(ATTRIBUTE)) {
    found.set(name.toLowerCase(), double ?? single ?? bare ?? "");
  }
  return found;
}

/**
 * The site-relative URLs of the scripts in `html` (`<script src>`) and the modules it preloads
 * (`<link rel="modulepreload">`), in document order. Scripts from other origins are left out.
 */
export function initialScripts(html: string): string[] {
  const urls: string[] = [];
  for (const [, tag = "", source = ""] of html.matchAll(TAG)) {
    const attrs = attributes(source);
    const url =
      tag.toLowerCase() === "script"
        ? attrs.get("src")
        : attrs.get("rel") === "modulepreload"
          ? attrs.get("href")
          : undefined;
    if (url?.startsWith("/") && !url.startsWith("//") && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
