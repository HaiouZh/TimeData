import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { getSetting, setSetting } from "./index.js";

beforeEach(resetDb);

describe("settings", () => {
  it("setSetting 写入值并记录同步日志", async () => {
    await setSetting("k", "v");

    await expect(getSetting("k")).resolves.toBe("v");
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "settings", recordId: "k", action: "create", synced: 0 },
    ]);
  });

  it("setSetting(null) 删除值并记录 delete 日志", async () => {
    await setSetting("k", "v");
    await db.syncLog.clear();

    await setSetting("k", null);

    await expect(getSetting("k")).resolves.toBeNull();
    await expect(db.syncLog.toArray()).resolves.toMatchObject([
      { tableName: "settings", recordId: "k", action: "delete", synced: 0 },
    ]);
  });
});
