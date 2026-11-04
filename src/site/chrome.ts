// The head tags, header and footer that the landing page and every docs page share, rendered at
// build time (see src/landing/vite-plugin.ts and src/docs/vite-plugin.ts). Pure: strings in,
// strings out, so it runs in Node and in tests.

const REPO = "https://github.com/Karthik-beta/Blinkql";

/** The brand wordmark the header inlines; the build plugins read it from disk. */
export const wordmarkSvgUrl = new URL(
  "../../brand/logo/blinkql-wordmark-light.svg",
  import.meta.url,
);

/** Icons, manifest and the browser's toolbar colour (from brand/web/head.html). */
export const siteHeadTags = [
  '<link rel="icon" href="/favicon.ico" sizes="32x32" />',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
  '<link rel="manifest" href="/site.webmanifest" />',
  '<meta name="theme-color" content="#EFF2EF" media="(prefers-color-scheme: light)" />',
  '<meta name="theme-color" content="#181B19" media="(prefers-color-scheme: dark)" />',
].join("\n    ");

/**
 * The brand wordmark as inline SVG, so its lamp can mirror the hero's run. The letters take the
 * text colour (one SVG for both themes) and the lamp gets a halo for the "done" flash.
 */
export function inlineWordmark(svg: string): string {
  const lamp = svg.match(/<circle class="lamp" cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"[^>]*\/>/);
  if (!lamp) throw new Error("The wordmark SVG has no lamp circle");
  const [circle, cx, cy, r] = lamp;
  return svg
    .replace(
      / width="\d+" height="\d+" role="img" aria-label="[^"]*"/,
      ' class="wordmark" aria-hidden="true"',
    )
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/fill="#1A201B"/g, 'fill="currentColor"')
    .replace(
      circle,
      `<circle class="wordmark-halo" cx="${cx}" cy="${cy}" r="${r}"/><circle class="wordmark-lamp" cx="${cx}" cy="${cy}" r="${r}"/>`,
    );
}

/**
 * Where the page sits relative to the docs: the docs home is the Docs link's own page, and a docs
 * page is inside the section it leads to.
 */
export type DocsPlace = "outside" | "home" | "page";

const docsCurrent: Record<DocsPlace, string> = {
  outside: "",
  home: ' aria-current="page"',
  page: ' aria-current="true"',
};

export function renderHeader(wordmarkSvg: string, place: DocsPlace): string {
  return `<header class="site-header">
      <div class="container site-header-inner">
        <a class="wordmark-link" href="/">${inlineWordmark(wordmarkSvg)}<span class="sr-only">Blinkql home</span></a>
        <nav aria-label="Main">
          <ul class="nav-list">
            <li><a href="/docs/"${docsCurrent[place]}>Docs</a></li>
            <li><a href="${REPO}">GitHub</a></li>
            <li><a href="/app/">Open the workbench</a></li>
          </ul>
        </nav>
      </div>
    </header>`;
}

export function renderFooter(): string {
  return `<footer class="site-footer">
      <div class="container site-footer-inner">
        <p>
          Blinkql is open source under the
          <a href="${REPO}/blob/main/LICENSE">MIT licence</a>.
          Built by <a href="https://karthik.nz/">Karthik Parameshwara</a>.
        </p>
        <ul class="footer-links">
          <li><a href="/app/">Workbench</a></li>
          <li><a href="/docs/">Docs</a></li>
          <li><a href="${REPO}">GitHub</a></li>
          <li><a href="${REPO}/wiki">Wiki</a></li>
        </ul>
        <p>This page uses no analytics and makes no third-party requests.</p>
      </div>
    </footer>`;
}
