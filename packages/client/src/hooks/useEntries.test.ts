import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { TimeEntry } from "@timedata/shared";
import { db } from "../db/index.js";
import { applyEntryOverlapAdjustments, deleteFutureEndedEntries, findFutureEndedEntries, findLatestEntryEndingBefore, findOverlappingEntries, findPreviousEntry, planEntryOverlapAdjustments, useEntryMutations, validateEntryTimeRange } from "./useEntries.js";

function entry(id: string, startTime: string, endTime: string): TimeEntry {
  return {
    id,
    categoryId: "cat-sleep-sleep",
    startTime,
    endTime,
    note: null,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
  };
}

beforeEach(async () => {
  await db.timeEntries.clear();
  await db.syncLog.clear();
});

describe("validateEntryTimeRange", () => {
  it("rejects entries ending in the future", () => {
    const now = new Date("2026-05-08T08:00:00+08:00");

    expect(() => validateEntryTimeRange("2026-05-08T07:00:00", "2026-05-08T08:01:00", now)).toThrow("不能记录尚未发生的时间");
    expect(() => validateEntryTimeRange("2026-05-08T07:00:00", "2026-05-08T08:00:00", now)).not.toThrow();
  });

  it("rejects entries whose end is not after start", () => {
    expect(() => validateEntryTimeRange("2026-05-08T08:00:00", "2026-05-08T08:00:00", new Date("2026-05-08T08:00:00+08:00"))).toThrow("结束时间必须晚于开始时间");
  });
});
describe("useEntryMutations", () => {
  it("does not save future entries locally or create sync logs", async () => {
    const { addEntry } = useEntryMutations();

    await expect(addEntry("cat-sleep-sleep", "2099-05-08T07:00:00", "2099-05-08T08:01:00")).rejects.toThrow("不能记录尚未发生的时间");
    await expect(db.timeEntries.count()).resolves.toBe(0);
    await expect(db.syncLog.count()).resolves.toBe(0);
  });

  it("does not update entries to future end times locally or create sync logs", async () => {
    await db.timeEntries.add(entry("existing", "2026-05-08T06:00:00", "2026-05-08T07:00:00"));
    const { updateEntry } = useEntryMutations();

    await expect(updateEntry("existing", { endTime: "2099-05-08T08:01:00" })).rejects.toThrow("不能记录尚未发生的时间");
    await expect(db.timeEntries.get("existing")).resolves.toMatchObject({ endTime: "2026-05-08T07:00:00" });
    await expect(db.syncLog.count()).resolves.toBe(0);
  });
});

describe("local future-ended entry repair", () => {
  it("finds only entries whose end time is in the future", async () => {
    await db.timeEntries.bulkAdd([
      entry("past", "2026-05-08T07:00:00", "2026-05-08T08:00:00"),
      entry("future-late", "2026-05-08T07:00:00", "2026-05-08T08:02:00"),
      entry("future-early", "2026-05-08T06:00:00", "2026-05-08T08:01:00"),
    ]);

    const entries = await findFutureEndedEntries(new Date("2026-05-08T08:00:00+08:00"));

    expect(entries.map((item) => item.id)).toEqual(["future-early", "future-late"]);
  });

  it("omits a local-only future entry from future repair push logs", async () => {
    await db.timeEntries.add(entry("future", "2026-05-08T07:00:00", "2026-05-08T08:01:00"));
    await db.syncLog.add({
      id: "future-create",
      tableName: "time_entries",
      recordId: "future",
      action: "create",
      timestamp: "2026-05-08T07:00:00.000Z",
      synced: false,
    });

    const result = await deleteFutureEndedEntries(new Date("2026-05-08T08:00:00+08:00"));

    expect(result).toEqual({ deletedCount: 1, deletedEntryIds: ["future"] });
    await expect(db.timeEntries.get("future")).resolves.toBeUndefined();
    await expect(db.syncLog.where("recordId").equals("future").toArray()).resolves.toMatchObject([
      { action: "create", synced: 1 },
    ]);
  });
});

describe("findOverlappingEntries", () => {
  it("finds local entries overlapping a range and excludes the current entry", async () => {
    await db.timeEntries.bulkAdd([
      entry("before", "2026-05-07T20:00:00", "2026-05-07T22:00:00"),
      entry("overlap", "2026-05-08T05:00:00", "2026-05-08T07:00:00"),
      entry("self", "2026-05-08T01:00:00", "2026-05-08T02:00:00"),
    ]);

    const overlaps = await findOverlappingEntries("2026-05-07T23:00:00", "2026-05-08T06:00:00", "self");

    expect(overlaps.map((item) => item.id)).toEqual(["overlap"]);
  });
});

describe("findPreviousEntry", () => {
  // 迁移后，Dexie 中的 startTime/endTime 均为 UTC ISO 字符串（上海时间减8小时）
  it("returns the latest entry before the selected day starts", async () => {
    await db.timeEntries.bulkAdd([
      entry("older", "2026-05-06T12:00:00.000Z", "2026-05-06T15:30:00.000Z"), // 上海 20:00–23:30 on May 6
      entry("old",    "2026-05-07T12:00:00.000Z", "2026-05-07T13:00:00.000Z"), // 上海 20:00–21:00 on May 7
      entry("latest", "2026-05-07T14:00:00.000Z", "2026-05-07T15:30:00.000Z"), // 上海 22:00–23:30 on May 7
      entry("today",  "2026-05-07T17:00:00.000Z", "2026-05-07T18:00:00.000Z"), // 上海 01:00–02:00 on May 8
    ]);

    await expect(findPreviousEntry("2026-05-08")).resolves.toMatchObject({ id: "latest", endTime: "2026-05-07T15:30:00.000Z" });
  });

  it("returns a previous-day entry that overlaps the selected day", async () => {
    await db.timeEntries.bulkAdd([
      entry("old",      "2026-05-07T12:00:00.000Z", "2026-05-07T13:00:00.000Z"), // 上海 20:00–21:00 on May 7
      entry("overnight","2026-05-07T15:57:00.000Z", "2026-05-07T22:00:00.000Z"), // 上海 23:57 May 7 – 06:00 May 8
      entry("today",    "2026-05-07T23:00:00.000Z", "2026-05-08T00:00:00.000Z"), // 上海 07:00–08:00 on May 8
    ]);

    await expect(findPreviousEntry("2026-05-08")).resolves.toMatchObject({
      id: "overnight",
      startTime: "2026-05-07T15:57:00.000Z",
      endTime: "2026-05-07T22:00:00.000Z",
    });
  });

  it("returns an older entry that still overlaps the selected day", async () => {
    await db.timeEntries.bulkAdd([
      entry("two-day", "2026-05-06T15:57:00.000Z", "2026-05-07T22:00:00.000Z"), // 上海 23:57 May 6 – 06:00 May 8
      entry("old",     "2026-05-07T12:00:00.000Z", "2026-05-07T13:00:00.000Z"), // 上海 20:00–21:00 on May 7
      entry("today",   "2026-05-07T23:00:00.000Z", "2026-05-08T00:00:00.000Z"), // 上海 07:00–08:00 on May 8
    ]);

    await expect(findPreviousEntry("2026-05-08")).resolves.toMatchObject({
      id: "two-day",
      startTime: "2026-05-06T15:57:00.000Z",
      endTime: "2026-05-07T22:00:00.000Z",
    });
  });
});

describe("planEntryOverlapAdjustments", () => {
  it("clips an overlapped tail to the new start", () => {
    const result = planEntryOverlapAdjustments([entry("old", "2026-05-07T20:00:00", "2026-05-08T01:00:00")], "2026-05-07T23:00:00", "2026-05-08T06:00:00");

    expect(result).toEqual({
      ok: true,
      updates: [{ id: "old", startTime: "2026-05-07T20:00:00", endTime: "2026-05-07T23:00:00" }],
      deletes: [],
    });
  });

  it("clips an overlapped head to the new end", () => {
    const result = planEntryOverlapAdjustments([entry("old", "2026-05-08T05:00:00", "2026-05-08T07:00:00")], "2026-05-07T23:00:00", "2026-05-08T06:00:00");

    expect(result).toEqual({
      ok: true,
      updates: [{ id: "old", startTime: "2026-05-08T06:00:00", endTime: "2026-05-08T07:00:00" }],
      deletes: [],
    });
  });

  it("deletes entries fully covered by the new range", () => {
    const result = planEntryOverlapAdjustments([entry("old", "2026-05-08T01:00:00", "2026-05-08T02:00:00")], "2026-05-07T23:00:00", "2026-05-08T06:00:00");

    expect(result).toEqual({ ok: true, updates: [], deletes: ["old"] });
  });

  it("rejects middle coverage that would require splitting one old entry", () => {
    const result = planEntryOverlapAdjustments([entry("old", "2026-05-07T20:00:00", "2026-05-08T07:00:00")], "2026-05-07T23:00:00", "2026-05-08T06:00:00");

    expect(result).toEqual({ ok: false, blockedEntryId: "old" });
  });
});

describe("applyEntryOverlapAdjustments", () => {
  it("updates and deletes local entries while recording sync logs", async () => {
    await db.timeEntries.bulkAdd([
      entry("update-me", "2026-05-08T05:00:00", "2026-05-08T07:00:00"),
      entry("delete-me", "2026-05-08T01:00:00", "2026-05-08T02:00:00"),
    ]);

    await applyEntryOverlapAdjustments({
      ok: true,
      updates: [{ id: "update-me", startTime: "2026-05-08T06:00:00", endTime: "2026-05-08T07:00:00" }],
      deletes: ["delete-me"],
    });

    await expect(db.timeEntries.get("update-me")).resolves.toMatchObject({ startTime: "2026-05-08T06:00:00", endTime: "2026-05-08T07:00:00" });
    await expect(db.timeEntries.get("delete-me")).resolves.toBeUndefined();
    await expect(db.syncLog.where("tableName").equals("time_entries").count()).resolves.toBe(2);
  });
});

describe("findLatestEntryEndingBefore", () => {
  it("returns the entry with the latest endTime strictly before the cutoff", async () => {
    await db.timeEntries.bulkAdd([
      entry("a", "2026-05-15T01:00:00.000Z", "2026-05-15T02:00:00.000Z"),
      entry("b", "2026-05-15T03:00:00.000Z", "2026-05-15T05:00:00.000Z"),
      entry("c", "2026-05-15T06:00:00.000Z", "2026-05-15T07:00:00.000Z"),
    ]);

    await expect(findLatestEntryEndingBefore("2026-05-15T06:00:00.000Z"))
      .resolves.toMatchObject({ id: "b", endTime: "2026-05-15T05:00:00.000Z" });
  });

  it("returns null when no entry ends before the cutoff", async () => {
    await db.timeEntries.add(entry("future", "2026-05-15T08:00:00.000Z", "2026-05-15T09:00:00.000Z"));
    await expect(findLatestEntryEndingBefore("2026-05-15T06:00:00.000Z")).resolves.toBeNull();
  });

  it("treats the cutoff as exclusive (entries ending exactly at cutoff are excluded)", async () => {
    await db.timeEntries.add(entry("edge", "2026-05-15T05:00:00.000Z", "2026-05-15T06:00:00.000Z"));
    await expect(findLatestEntryEndingBefore("2026-05-15T06:00:00.000Z")).resolves.toBeNull();
  });
});
