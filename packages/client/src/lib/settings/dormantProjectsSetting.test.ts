import { beforeEach, describe, expect, it } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import {
  DORMANT_PROJECTS_KEY,
  readDormantProjects,
  sanitizeDormantProjects,
  setProjectDormant,
} from "./dormantProjectsSetting.js";

beforeEach(resetDb);

describe("dormantProjectsSetting", () => {
  it("未设置时是空集", async () => {
    await expect(readDormantProjects()).resolves.toEqual(new Set());
  });

  it("sanitize：去重、去空白、丢掉非字符串项，顺序稳定", () => {
    expect(sanitizeDormantProjects(["g1", "g1", " g2 ", "", "   ", 7, null, "g3"])).toEqual(["g1", "g2", "g3"]);
  });

  it("sanitize：非数组一律空（坏 JSON / 远端塞了对象都不该炸页面）", () => {
    expect(sanitizeDormantProjects({ g1: true })).toEqual([]);
    expect(sanitizeDormantProjects(null)).toEqual([]);
    expect(sanitizeDormantProjects("g1")).toEqual([]);
  });

  it("坏 JSON 读成空集而不是抛", async () => {
    await db.settings.put({ key: DORMANT_PROJECTS_KEY, value: "{不是 JSON", updatedAt: "2026-08-22T00:00:00.000Z" });
    await expect(readDormantProjects()).resolves.toEqual(new Set());
  });

  it("按下沉睡：写入并留一条 settings syncLog（跨设备同步靠它）", async () => {
    await setProjectDormant("g1", true);

    await expect(readDormantProjects()).resolves.toEqual(new Set(["g1"]));
    const logs = await db.syncLog.where("recordId").equals(DORMANT_PROJECTS_KEY).toArray();
    expect(logs[0]).toMatchObject({ tableName: "settings", action: "create", synced: 0 });
  });

  it("重复按下同一个不产生重复项", async () => {
    await setProjectDormant("g1", true);
    await setProjectDormant("g1", true);
    await expect(readDormantProjects()).resolves.toEqual(new Set(["g1"]));
  });

  it("唤回：只摘自己，别人还睡着", async () => {
    await setProjectDormant("g1", true);
    await setProjectDormant("g2", true);
    await setProjectDormant("g1", false);
    await expect(readDormantProjects()).resolves.toEqual(new Set(["g2"]));
  });

  it("唤回最后一个：键留着但值是空数组，不留悬空的旧值", async () => {
    await setProjectDormant("g1", true);
    await setProjectDormant("g1", false);
    await expect(readDormantProjects()).resolves.toEqual(new Set());
    expect((await db.settings.get(DORMANT_PROJECTS_KEY))?.value).toBe("[]");
  });

  it("唤回一个从没睡过的：不写库、不产生 syncLog（免得每次开菜单都推一条同步）", async () => {
    await setProjectDormant("g1", false);
    expect(await db.settings.get(DORMANT_PROJECTS_KEY)).toBeUndefined();
    expect(await db.syncLog.where("recordId").equals(DORMANT_PROJECTS_KEY).count()).toBe(0);
  });
});
