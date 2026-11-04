import { describe, expect, it } from "vitest";
import { memoryWarning } from "./memory";

const GiB = 2 ** 30;

describe("memoryWarning", () => {
  it("warns about files over half the device's memory", () => {
    expect(memoryWarning(1.5 * GiB, { deviceMemoryGiB: 2 })).toMatch(/large for this device/);
    expect(memoryWarning(1 * GiB, { deviceMemoryGiB: 2 })).toBeNull();
  });

  it("caps the budget at the 4 GiB the engine can address", () => {
    expect(memoryWarning(2.5 * GiB, { deviceMemoryGiB: 8 })).not.toBeNull();
    expect(memoryWarning(2 * GiB, { deviceMemoryGiB: 8 })).toBeNull();
  });

  it("assumes the 4 GiB ceiling when the device's memory is unknown", () => {
    expect(memoryWarning(2.5 * GiB, {})).not.toBeNull();
    expect(memoryWarning(2 * GiB, {})).toBeNull();
  });

  it("suggests ways to query with less memory", () => {
    expect(memoryWarning(3 * GiB, {})).toMatch(/LIMIT/);
  });
});
