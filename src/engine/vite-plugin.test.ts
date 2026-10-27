// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { streamModuleFromFetch } from "./vite-plugin";

const require = createRequire(import.meta.url);
const worker = (name: string) =>
  readFileSync(
    require.resolve(`@duckdb/duckdb-wasm/dist/duckdb-browser-${name}.worker.js`),
    "utf8",
  );

describe("streamModuleFromFetch", () => {
  it.each(["eh", "mvp"])("compiles the %s worker's module from fetch()'s own response", (name) => {
    const source = worker(name);
    const built = streamModuleFromFetch(source);

    expect(built).not.toMatch(/new Response\(\(\w=\w\.body\)/);
    expect(built.length).toBeLessThan(source.length);
  });

  it("rewrites the copy into the response it was made from", () => {
    expect(
      streamModuleFromFetch("{return new Response((g=c.body)==null?void 0:g.pipeThrough(m),c)}"),
    ).toBe("{return c}");
  });

  it("fails the build when the worker no longer matches", () => {
    expect(() => streamModuleFromFetch("return fetch(url)")).toThrow(/found 0/);
  });
});
