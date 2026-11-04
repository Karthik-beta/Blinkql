// Ships the DuckDB extensions listed in extensions.ts with the build (and serves them from the dev
// server). Imported by vite.config.ts, so it runs in Node: no DOM here.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { EXTENSIONS_PATH, extensionChecksums, extensionsVersion } from "./extensions.ts";

const SOURCE = "https://extensions.duckdb.org";
const cacheDir = fileURLToPath(
  new URL("../../node_modules/.cache/duckdb-extensions/", import.meta.url),
);

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** One extension file: from the local cache if it's there and intact, else downloaded. */
async function loadExtension(file: string, checksum: string): Promise<Uint8Array> {
  const cached = join(cacheDir, extensionsVersion, file);
  const fromCache = await readFile(cached).catch(() => null);
  if (fromCache && sha256(fromCache) === checksum) return fromCache;

  const url = `${SOURCE}/${extensionsVersion}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== checksum) {
    throw new Error(
      `${url} doesn't match its checksum in src/engine/extensions.ts (expected ${checksum}, got ${actual})`,
    );
  }
  await mkdir(dirname(cached), { recursive: true });
  await writeFile(cached, data);
  return data;
}

// DuckDB-wasm's workers stream the engine's module through a progress counter into a new Response
// before compiling it. Chromium only caches the compiled module for a response that came from
// fetch() itself, so the copy made every start compile it again (P-13). Blinkql doesn't use the
// progress, so the built workers compile fetch()'s own response instead.
const PROGRESS_COPY =
  /return new Response\(\((\w)=(\w)\.body\)==null\?void 0:\1\.pipeThrough\(\w\),\2\)/g;

/** `source`, a DuckDB-wasm browser worker, compiling the module from fetch()'s own response. */
export function streamModuleFromFetch(source: string): string {
  const matches = source.match(PROGRESS_COPY)?.length ?? 0;
  if (matches !== 1) {
    throw new Error(
      `Expected DuckDB-wasm's worker to copy the module's response once, found ${matches}; check src/engine/vite-plugin.ts against the new version`,
    );
  }
  return source.replace(PROGRESS_COPY, "return $2");
}

const WORKER = /\/@duckdb\/duckdb-wasm\/dist\/(duckdb-browser-(?:eh|mvp)\.worker\.js)\?url$/;

/**
 * Builds DuckDB-wasm's eh and mvp workers with streamModuleFromFetch(). The worker is emitted as
 * an asset of its own, so its content hash covers the change. The dev server serves them as is.
 */
export function duckdbWorkers(): Plugin {
  return {
    name: "blinkql:duckdb-workers",
    apply: "build",
    enforce: "pre",
    async load(id) {
      const worker = WORKER.exec(id.replaceAll("\\", "/"));
      if (!worker) return;
      const source = await readFile(id.slice(0, -"?url".length), "utf8");
      const ref = this.emitFile({
        type: "asset",
        name: worker[1],
        source: streamModuleFromFetch(source),
      });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
  };
}

export function duckdbExtensions(): Plugin {
  let files: Promise<Map<string, Uint8Array>> | undefined;
  const loadAll = () => {
    files ??= Promise.all(
      Object.entries(extensionChecksums).map(
        async ([file, checksum]) => [file, await loadExtension(file, checksum)] as const,
      ),
    ).then((entries) => new Map(entries));
    return files;
  };
  const prefix = `${EXTENSIONS_PATH}/${extensionsVersion}/`;

  return {
    name: "blinkql:duckdb-extensions",
    async generateBundle() {
      for (const [file, source] of await loadAll()) {
        this.emitFile({ type: "asset", fileName: `${prefix.slice(1)}${file}`, source });
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split("?")[0];
        if (!path?.startsWith(prefix)) return next();
        const data = (await loadAll()).get(path.slice(prefix.length));
        if (!data) return next();
        response.setHeader("Content-Type", "application/wasm");
        response.end(data);
      });
    },
  };
}
