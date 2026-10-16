import { afterEach, describe, expect, it, vi } from "vitest";
import { restart } from "./restart";

const mocks = vi.hoisted(() => ({
  restartEngine: vi.fn(async () => {}),
  reimportTables: vi.fn(async () => {}),
  resetQueryRun: vi.fn(),
}));
vi.mock("@/engine/engine", () => ({ restartEngine: mocks.restartEngine }));
vi.mock("@/features/catalog/catalog", () => ({ reimportTables: mocks.reimportTables }));
vi.mock("@/features/results/query-run", () => ({ resetQueryRun: mocks.resetQueryRun }));

describe("restart", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("clears the failed query, restarts the engine, then imports the files again", async () => {
    const order: string[] = [];
    mocks.resetQueryRun.mockImplementationOnce(() => order.push("reset"));
    mocks.restartEngine.mockImplementationOnce(async () => void order.push("engine"));
    mocks.reimportTables.mockImplementationOnce(async () => void order.push("reimport"));

    await restart();
    expect(order).toEqual(["reset", "engine", "reimport"]);
  });

  it("leaves the tables alone if the engine doesn't start", async () => {
    mocks.restartEngine.mockRejectedValueOnce(new Error("wasm failed to compile"));

    await restart();
    expect(mocks.reimportTables).not.toHaveBeenCalled();
  });

  it("restarts once however often it's pressed", async () => {
    await Promise.all([restart(), restart()]);
    expect(mocks.restartEngine).toHaveBeenCalledTimes(1);
  });
});
