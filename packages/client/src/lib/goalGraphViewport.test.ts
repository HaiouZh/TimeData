import { describe, expect, it, vi } from "vitest";
import {
  clearGoalGraphViewport,
  loadGoalGraphViewport,
  saveGoalGraphViewport,
  type GoalGraphViewport,
} from "./goalGraphViewport.js";

type MockStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function createStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  } satisfies MockStorage;
}

describe("goalGraphViewport", () => {
  it("saves and loads a viewport with zoom clamped", () => {
    const storage = createStorage();

    saveGoalGraphViewport("alpha", { x: 12, y: -8, zoom: 9 } satisfies GoalGraphViewport, storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      "timedata.goalGraphViewport.alpha",
      JSON.stringify({ x: 12, y: -8, zoom: 2.5 }),
    );
    expect(loadGoalGraphViewport("alpha", storage)).toEqual({ x: 12, y: -8, zoom: 2.5 });
  });

  it("returns null and removes invalid stored data", () => {
    const storage = createStorage({ "timedata.goalGraphViewport.alpha": "{broken" });

    expect(loadGoalGraphViewport("alpha", storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith("timedata.goalGraphViewport.alpha");
  });

  it("returns null and removes non-finite values", () => {
    const storage = createStorage({
      "timedata.goalGraphViewport.alpha": JSON.stringify({ x: 1, y: "nope", zoom: 1 }),
    });

    expect(loadGoalGraphViewport("alpha", storage)).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith("timedata.goalGraphViewport.alpha");
  });

  it("clears the stored viewport", () => {
    const storage = createStorage();

    clearGoalGraphViewport("alpha", storage);

    expect(storage.removeItem).toHaveBeenCalledWith("timedata.goalGraphViewport.alpha");
  });
});
