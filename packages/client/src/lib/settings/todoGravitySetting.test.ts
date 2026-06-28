import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.ts";
import {
  DEFAULT_TODO_GRAVITY_SETTINGS,
  TODO_GRAVITY_SETTING_KEY,
  readTodoGravitySettings,
  sanitizeTodoGravitySettings,
  setTodoGravitySettings,
} from "./todoGravitySetting.ts";

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

describe("todoGravitySetting", () => {
  it("returns defaults when unset", async () => {
    await expect(readTodoGravitySettings()).resolves.toEqual(DEFAULT_TODO_GRAVITY_SETTINGS);
  });

  it("sanitizes partial and invalid values", () => {
    expect(
      sanitizeTodoGravitySettings({
        enabled: false,
        waterlineDays: 0,
        weightStepDays: 9999,
        graceDays: 3,
        drawM: 20,
        pickN: 0,
      }),
    ).toEqual({
      enabled: false,
      waterlineDays: 1,
      weightStepDays: 365,
      graceDays: 3,
      drawM: 10,
      pickN: 1,
    });
  });

  it("persists settings and writes sync log", async () => {
    await setTodoGravitySettings({ ...DEFAULT_TODO_GRAVITY_SETTINGS, drawM: 4, pickN: 2 });

    await expect(readTodoGravitySettings()).resolves.toMatchObject({ drawM: 4, pickN: 2 });
    const logs = await db.syncLog.where("recordId").equals(TODO_GRAVITY_SETTING_KEY).toArray();
    expect(logs[0]).toMatchObject({ tableName: "settings", action: "create", synced: 0 });
  });
});