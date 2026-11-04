// Where query history, saved queries and settings live between visits: one IndexedDB database,
// behind a small interface so the logic around it can be tested with an in-memory copy.

export type StoreName = "history" | "saved" | "settings";

/** Records keyed by their `id`. */
export type KeyValueStore = {
  getAll<T>(store: StoreName): Promise<T[]>;
  put(store: StoreName, value: { id: string }): Promise<void>;
  delete(store: StoreName, ids: readonly string[]): Promise<void>;
};

const DATABASE = "blinkql";
const VERSION = 1;
const STORES: readonly StoreName[] = ["history", "saved", "settings"];

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** The browser's IndexedDB. */
export async function indexedDbStore(): Promise<KeyValueStore> {
  const open = indexedDB.open(DATABASE, VERSION);
  open.onupgradeneeded = () => {
    for (const store of STORES) {
      if (!open.result.objectStoreNames.contains(store)) {
        open.result.createObjectStore(store, { keyPath: "id" });
      }
    }
  };
  const db = await settled(open);
  return {
    getAll: (store) => settled(db.transaction(store).objectStore(store).getAll()),
    put(store, value) {
      const transaction = db.transaction(store, "readwrite");
      transaction.objectStore(store).put(value);
      return committed(transaction);
    },
    delete(store, ids) {
      const transaction = db.transaction(store, "readwrite");
      for (const id of ids) transaction.objectStore(store).delete(id);
      return committed(transaction);
    },
  };
}

/** A store that lasts as long as the page: for tests, and browsers without IndexedDB. */
export function memoryStore(): KeyValueStore {
  const stores = new Map<StoreName, Map<string, unknown>>(STORES.map((name) => [name, new Map()]));
  const of = (store: StoreName) => stores.get(store) ?? new Map<string, unknown>();
  return {
    getAll: async <T>(store: StoreName) => [...of(store).values()].map((value) => value as T),
    put: async (store, value) => {
      of(store).set(value.id, structuredClone(value));
    },
    delete: async (store, ids) => {
      for (const id of ids) of(store).delete(id);
    },
  };
}
