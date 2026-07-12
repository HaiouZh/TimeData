import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock 工厂会被提升到 import 之前执行，普通 const 会踩 TDZ，必须用 vi.hoisted。
const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("./db/index.ts", () => ({
  seedDefaultCategories: vi.fn(async () => {
    calls.push("seed");
  }),
  migrateLocalSettingsToDexie: vi.fn(async () => {
    calls.push("migrate");
  }),
}));

vi.mock("./db/schemaNormalization.ts", () => ({
  runSchemaNormalizationIfNeeded: vi.fn(async () => {
    calls.push("normalize");
  }),
}));

vi.mock("./lib/tasks.js", () => ({
  runMaterialization: vi.fn(async () => {
    calls.push("materialize");
  }),
}));

import { runSchemaNormalizationIfNeeded } from "./db/schemaNormalization.ts";
import { runStartupTasks } from "./startup.ts";

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("runStartupTasks", () => {
  it("按 seed -> migrate -> normalize -> materialize 顺序执行", async () => {
    await runStartupTasks();
    expect(calls).toEqual(["seed", "migrate", "normalize", "materialize"]);
  });

  it("中途抛错时吞掉异常不上抛", async () => {
    vi.mocked(runSchemaNormalizationIfNeeded).mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runStartupTasks()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});