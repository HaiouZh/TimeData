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
  migrateGoalPrerequisitesToRelations: vi.fn(async () => {
    calls.push("relations");
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
import { runStartupTasks, warmMaterialization } from "./startup.ts";

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("runStartupTasks", () => {
  it("按 seed -> migrate -> relations -> normalize 顺序执行", async () => {
    await runStartupTasks();
    expect(calls).toEqual(["seed", "migrate", "relations", "normalize"]);
  });

  it("物化不在启动链里——它是全表扫，已移出去单独空闲预热", async () => {
    await runStartupTasks();
    expect(calls).not.toContain("materialize");
  });

  it("首次运行照跑前置边搬家，闸不会把没迁过的数据挡在门外", async () => {
    // node 环境没有 localStorage，safeGetItem 恒返回 null，等价于「从没跑过」这一档。
    await runStartupTasks();
    expect(calls).toContain("relations");
  });

  it("物化仍会被跑，只是换到了 warmMaterialization", async () => {
    await warmMaterialization();
    expect(calls).toEqual(["materialize"]);
  });

  it("中途抛错时吞掉异常不上抛", async () => {
    vi.mocked(runSchemaNormalizationIfNeeded).mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runStartupTasks()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});