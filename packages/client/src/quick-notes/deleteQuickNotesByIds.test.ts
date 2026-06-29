import { beforeEach, describe, expect, it } from "vitest";
import { addQuickNote } from "../lib/quickNotes.js";
import { db, resetDb } from "../test/dbReset.js";
import { deleteQuickNotesByIds } from "./deleteQuickNotesByIds.js";

beforeEach(resetDb);

describe("deleteQuickNotesByIds", () => {
  it("删除选中的多条并为每条写一条 delete 同步日志", async () => {
    const a = await addQuickNote("一");
    const b = await addQuickNote("二");
    const c = await addQuickNote("三");
    await db.syncLog.clear();

    const result = await deleteQuickNotesByIds([a.id, c.id]);

    expect(result.deleted).toBe(2);
    await expect(db.quickNotes.toArray()).resolves.toMatchObject([{ id: b.id }]);
    const logs = await db.syncLog.toArray();
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.tableName === "quick_notes" && log.action === "delete")).toBe(true);
  });

  it("空数组不做任何事", async () => {
    await addQuickNote("一");
    await db.syncLog.clear();

    const result = await deleteQuickNotesByIds([]);

    expect(result.deleted).toBe(0);
    await expect(db.syncLog.count()).resolves.toBe(0);
  });
});
