// Copies of imported files kept in the browser's Origin Private File System, so their tables come
// back after a reload. Each file is stored under its table's name in a `datasets` directory, next
// to a manifest that says what it is.
import type { FileFormat } from "./formats";

export type StoredDataset = {
  /** The table's name, which is also the stored file's name. */
  name: string;
  /** The name of the file the user imported. */
  fileName: string;
  format: FileFormat;
  /** In bytes. */
  size: number;
  /** In milliseconds since the epoch. */
  savedAt: number;
};

const DIRECTORY = "datasets";
const MANIFEST = "manifest.json";

let persistRequested = false;
/** Manifest updates run one after another, so concurrent saves can't lose each other's entries. */
let manifestQueue: Promise<unknown> = Promise.resolve();

/** The datasets directory. Rejects where the browser has no Origin Private File System. */
async function directory(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    throw new Error("This browser can't store files");
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIRECTORY, { create: true });
}

async function readManifest(dir: FileSystemDirectoryHandle): Promise<StoredDataset[]> {
  try {
    const file = await (await dir.getFileHandle(MANIFEST)).getFile();
    return JSON.parse(await file.text()) as StoredDataset[];
  } catch {
    return [];
  }
}

function updateManifest(
  change: (datasets: StoredDataset[]) => StoredDataset[],
): Promise<StoredDataset[]> {
  const next = manifestQueue.then(async () => {
    const dir = await directory();
    const datasets = change(await readManifest(dir));
    const writable = await (await dir.getFileHandle(MANIFEST, { create: true })).createWritable();
    await writable.write(JSON.stringify(datasets));
    await writable.close();
    return datasets;
  });
  manifestQueue = next.catch(() => {});
  return next;
}

/**
 * Stores `file` under `meta.name`, replacing any dataset of that name. The file is streamed to
 * disk, so it's never read into memory whole. Rejects if it can't be stored, e.g. over quota.
 */
export async function saveDataset(meta: StoredDataset, file: Blob): Promise<void> {
  const dir = await directory();
  if (!persistRequested) {
    persistRequested = true;
    // Asks the browser not to evict the files under storage pressure; it may say no.
    void navigator.storage.persist?.().catch(() => {});
  }
  const writable = await (await dir.getFileHandle(meta.name, { create: true })).createWritable();
  try {
    await file.stream().pipeTo(writable);
  } catch (error) {
    await dir.removeEntry(meta.name).catch(() => {});
    throw error;
  }
  await updateManifest((datasets) => [
    ...datasets.filter((dataset) => dataset.name !== meta.name),
    meta,
  ]);
}

/** The stored datasets, oldest first. Empty where nothing can be stored. */
export async function listDatasets(): Promise<StoredDataset[]> {
  try {
    await manifestQueue;
    const datasets = await readManifest(await directory());
    return datasets.sort((a, b) => a.savedAt - b.savedAt);
  } catch {
    return [];
  }
}

/** The stored copy of dataset `name`, read from disk on demand. */
export async function loadDataset(name: string): Promise<File> {
  return (await (await directory()).getFileHandle(name)).getFile();
}

/** Deletes dataset `name`, if it's stored. */
export async function removeDataset(name: string): Promise<void> {
  await updateManifest((datasets) => datasets.filter((dataset) => dataset.name !== name));
  await (await directory()).removeEntry(name).catch(() => {});
}
