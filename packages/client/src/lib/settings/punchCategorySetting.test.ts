import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { getPunchCategoryId, PUNCH_CATEGORY_KEY, setPunchCategoryId } from "./punchCategorySetting.js";

beforeEach(resetDb);

describe("punchCategorySetting", () => {
  it("defaults to null when unset", async () => {
    await expect(getPunchCategoryId()).resolves.toBeNull();
  });

  it("persists selection and writes a settings syncLog", async () => {
    await setPunchCategoryId("cat-work-deep");

    await expect(getPunchCategoryId()).resolves.toBe("cat-work-deep");
    await expect(db.settings.get(PUNCH_CATEGORY_KEY)).resolves.toMatchObject({ value: "cat-work-deep" });
    const logs = await db.syncLog.where("recordId").equals(PUNCH_CATEGORY_KEY).toArray();
    expect(logs[0]).toMatchObject({ tableName: "settings", action: "create", synced: 0 });
  });

  it("clears selection when set to null", async () => {
    await setPunchCategoryId("cat-work-deep");
    await setPunchCategoryId(null);

    await expect(getPunchCategoryId()).resolves.toBeNull();
    const logs = await db.syncLog.where("recordId").equals(PUNCH_CATEGORY_KEY).toArray();
    expect(logs).toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "settings", action: "delete", synced: 0 })]),
    );
  });
});
