import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/index.js";
import {
  TODO_DEFAULT_DESTINATION_KEY,
  readTodoDefaultDestination,
  sanitizeDestination,
  setTodoDefaultDestination,
} from "./todoDefaultDestinationSetting.js";

beforeEach(async () => {
  await db.settings.clear();
  await db.syncLog.clear();
});

describe("todoDefaultDestinationSetting", () => {
  it("defaults to today when unset", async () => {
    await expect(readTodoDefaultDestination()).resolves.toBe("today");
  });

  it("sanitize maps unknown values to today, keeps inbox", () => {
    expect(sanitizeDestination("inbox")).toBe("inbox");
    expect(sanitizeDestination("today")).toBe("today");
    expect(sanitizeDestination("bogus")).toBe("today");
    expect(sanitizeDestination(null)).toBe("today");
  });

  it("persists selection and writes a settings syncLog", async () => {
    await setTodoDefaultDestination("inbox");

    await expect(readTodoDefaultDestination()).resolves.toBe("inbox");
    const logs = await db.syncLog.where("recordId").equals(TODO_DEFAULT_DESTINATION_KEY).toArray();
    expect(logs[0]).toMatchObject({ tableName: "settings", action: "create", synced: 0 });
  });
});
