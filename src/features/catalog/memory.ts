// Warning before a file is likely to exhaust the engine's memory. DuckDB-wasm is 32-bit, so it can
// address 4 GiB at most, and less on devices that report less memory.
const GiB = 2 ** 30;
const WASM_CEILING_GIB = 4;

/** A warning when a file of `fileSize` bytes is large for this device's memory, else null. */
export function memoryWarning(
  fileSize: number,
  memory: { deviceMemoryGiB?: number },
): string | null {
  const budget = Math.min(memory.deviceMemoryGiB ?? WASM_CEILING_GIB, WASM_CEILING_GIB) * GiB;
  if (fileSize <= budget / 2) return null;
  return "This file is large for this device's memory. If queries fail, add a LIMIT, select fewer columns or aggregate.";
}

/** The device's memory in GiB, from the non-standard navigator.deviceMemory, when the browser gives it. */
export function deviceMemoryGiB(): number | undefined {
  const value = (globalThis.navigator as { deviceMemory?: unknown } | undefined)?.deviceMemory;
  return typeof value === "number" && value > 0 ? value : undefined;
}
