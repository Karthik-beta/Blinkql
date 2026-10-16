/** The engine itself failed (its worker died, or WebAssembly trapped), not the query. */
export class EngineCrashedError extends Error {
  override name = "EngineCrashedError";
}
