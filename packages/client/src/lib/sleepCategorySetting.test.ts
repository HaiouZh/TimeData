import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import { getSleepCategoryId, SLEEP_CATEGORY_KEY, setSleepCategoryId } from "./sleepCategorySetting.js";

beforeEach(resetDb);

describe("sleepCategorySetting", () => {
  it("默认未指定返回 null", async () => {
    await expect(getSleepCategoryId()).resolves.toBeNull();
  });

  it("写入后可读回", async () => {
    await setSleepCategoryId("cat-sleep");

    await expect(getSleepCategoryId()).resolves.toBe("cat-sleep");
    await expect(db.settings.get(SLEEP_CATEGORY_KEY)).resolves.toMatchObject({ value: "cat-sleep" });
  });

  it("传 null 清除设置", async () => {
    await setSleepCategoryId("cat-sleep");
    await setSleepCategoryId(null);

    await expect(getSleepCategoryId()).resolves.toBeNull();
  });
});
