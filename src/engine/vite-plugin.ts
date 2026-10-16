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
