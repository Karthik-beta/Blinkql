// @vitest-environment node
// jsdom's Blob has no stream(), which saving pipes from.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredDataset } from "./stored-datasets";

/** Just enough of the Origin Private File System: directories of files held in memory. */
class FakeDirectory {
  readonly entries = new Map<string, FakeDirectory | Blob>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (!this.entries.has(name) && options?.create) this.entries.set(name, new FakeDirectory());
    const entry = this.entries.get(name);
    if (!(entry instanceof FakeDirectory)) throw new DOMException(name, "NotFoundError");
    return entry;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.entries.has(name)) {
      if (!options?.create) throw new DOMException(name, "NotFoundError");
      this.entries.set(name, new Blob());
    }
    return {
      getFile: async () => new File([this.entries.get(name) as Blob], name),
      createWritable: async () => {
        const parts: BlobPart[] = [];
        const writable = new WritableStream<BlobPart>({
          write: (chunk) => {
            parts.push(chunk);
          },
          close: () => {
            this.entries.set(name, new Blob(parts));
          },
        });
        // Like a FileSystemWritableFileStream, it can be piped to or written to directly.
        return Object.assign(writable, {
          write: async (chunk: BlobPart) => {
            parts.push(chunk);
          },
          close: async () => {
            this.entries.set(name, new Blob(parts));
          },
        });
      },
    };
  }

  async removeEntry(name: string) {
    if (!this.entries.delete(name)) throw new DOMException(name, "NotFoundError");
  }
}

const meta = (name: string, savedAt = 1): StoredDataset => ({
  name,
  fileName: `${name}.csv`,
  format: "csv",
  size: 6,
  savedAt,
});

let root: FakeDirectory;
let persist: ReturnType<typeof vi.fn>;

async function load() {
  vi.resetModules();
  return import("./stored-datasets");
}

describe("stored datasets", () => {
  beforeEach(() => {
    root = new FakeDirectory();
    persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root, persist } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("stores a file and lists it after a reload", async () => {
    const before = await load();
    await before.saveDataset(meta("orders"), new Blob(["a,b\n1,2"]));

    const after = await load();
    expect(await after.listDatasets()).toEqual([meta("orders")]);
    expect(await (await after.loadDataset("orders")).text()).toBe("a,b\n1,2");
  });

  it("keeps every dataset when several are saved at once", async () => {
    const { saveDataset, listDatasets } = await load();
    await Promise.all(
      ["a", "b", "c"].map((name, index) => saveDataset(meta(name, index), new Blob([name]))),
    );

    expect((await listDatasets()).map((dataset) => dataset.name)).toEqual(["a", "b", "c"]);
  });

  it("replaces a dataset saved again under the same name", async () => {
    const { saveDataset, listDatasets, loadDataset } = await load();
    await saveDataset(meta("orders", 1), new Blob(["old"]));
    await saveDataset({ ...meta("orders", 2), format: "parquet" }, new Blob(["new"]));

    expect(await listDatasets()).toEqual([{ ...meta("orders", 2), format: "parquet" }]);
    expect(await (await loadDataset("orders")).text()).toBe("new");
  });

  it("asks for persistent storage once, on the first save", async () => {
    const { saveDataset } = await load();
    await saveDataset(meta("a"), new Blob(["a"]));
    await saveDataset(meta("b"), new Blob(["b"]));

    expect(persist).toHaveBeenCalledOnce();
  });

  it("removes a dataset and its file", async () => {
    const { saveDataset, removeDataset, listDatasets, loadDataset } = await load();
    await saveDataset(meta("orders"), new Blob(["a"]));
    await removeDataset("orders");

    expect(await listDatasets()).toEqual([]);
    await expect(loadDataset("orders")).rejects.toThrow();
  });

  it("stores nothing, and lists nothing, where the browser has no file system", async () => {
    vi.stubGlobal("navigator", {});
    const { saveDataset, listDatasets } = await load();

    await expect(saveDataset(meta("orders"), new Blob(["a"]))).rejects.toThrow();
    expect(await listDatasets()).toEqual([]);
  });
});
