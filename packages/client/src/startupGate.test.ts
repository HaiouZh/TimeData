import { describe, expect, it } from "vitest";
import { GOAL_PREREQ_MIGRATION_VERSION, shouldRunGoalPrereqMigration } from "./startupGate.js";

describe("前置边搬家的版本闸", () => {
  it("没跑过就要跑", () => {
    expect(shouldRunGoalPrereqMigration(null, 1)).toBe(true);
  });

  it("跑过同版本就跳过——每次冷启动全表读 goals 是纯浪费", () => {
    expect(shouldRunGoalPrereqMigration("1", 1)).toBe(false);
  });

  it("存的版本更高也跳过（降级装回旧版不该倒着搬）", () => {
    expect(shouldRunGoalPrereqMigration("2", 1)).toBe(false);
  });

  it("bump 版本号后重新跑一轮", () => {
    expect(shouldRunGoalPrereqMigration("1", 2)).toBe(true);
  });

  it("存了垃圾值当没跑过——宁可多跑一次也不能漏迁移", () => {
    expect(shouldRunGoalPrereqMigration("不是数字", 1)).toBe(true);
    expect(shouldRunGoalPrereqMigration("", 1)).toBe(true);
  });

  it("空白串与 Infinity 这类会被 Number() 悄悄接受的值不算跑过", () => {
    // Number(" ") === 0 而不是 NaN；Number("Infinity") 是有限性检查才拦得住的。
    // 两者都不能被当成「跑过某个版本」，否则老数据的迁移会被静默跳过。
    expect(shouldRunGoalPrereqMigration(" ", 1)).toBe(true);
    expect(shouldRunGoalPrereqMigration("Infinity", 1)).toBe(true);
  });

  it("当前版本号是 1", () => {
    expect(GOAL_PREREQ_MIGRATION_VERSION).toBe(1);
  });
});
