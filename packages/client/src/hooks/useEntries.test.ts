import type { TimeEntry } from "@timedata/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../test/dbReset.js";
import {
  applyEntryOverlapAdjustments,
  findAdjacentEntriesForRange,
  findLatestEntryEndingBefore,
  findOverlappingEntries,
  findPreviousEntry,
  planEntryOverlapAdjustments,
  saveEntryWithOverlapAdjustments,
  useEntryMutations,
  validateEntryTimeRange,
} from "./useEntries.js";

function entry(id: string, startTime: string, endTime: string): TimeEntry;
function entry(overrides: Partial<TimeEntry> & { id: string; startTime: string; endTime: string }): TimeEntry;
function entry(
  idOrOverrides: string | (Partial<TimeEntry> & { id: string; startTime: string; endTime: string }),
  startTime?: string,
  endTime?: string,
): TimeEntry {
  const overrides =
    typeof idOrOverrides === "string"
      ? { id: idOrOverrides, startTime: startTime ?? "", endTime: endTime ?? "" }
      : idOrOverrides;
  return {
    categoryId: "cat-sleep-sleep",
    note: null,
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(resetDb);

describe("validateEntryTimeRange", () => {
  it("rejects entries ending in the future", () => {
    const now = new Date("2026-05-08T08:00:00+08:00");

    expect(() => validateEntryTimeRange("2026-05-08T07:00:00", "2026-05-08T08:01:00", now)).toThrow(
      "不能记录尚未发生的时间",
    );
    expect(() => validateEntryTimeRange("2026-05-08T07:00:00", "2026-05-08T08:00:00", now)).not.toThrow();
  });

  it("rejects entries whose end is not after start", () => {
    expect(() =>
      validateEntryTimeRange("2026-05-08T08:00:00", "2026-05-08T08:00:00", new Date("2026-05-08T08:00:00+08:00")),
    ).toThrow("结束时间必须晚于开始时间");
  });
});
describe("useEntryMutations", () => {
  it("does not save future entries locally or create sync logs", async () => {
    const { addEntry } = useEntryMutations();

    await expect(addEntry("cat-sleep-sleep", "2099-05-08T07:00:00", "2099-05-08T08:01:00")).rejects.toThrow(
      "不能记录尚未发生的时间",
    );
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

  it("rolls back added entry when sync log creation fails", async () => {
    vi.spyOn(db.syncLog, "add").mockRejectedValueOnce(new Error("sync log failed"));
    const { addEntry } = useEntryMutations();

    await expect(addEntry("cat-sleep-sleep", "2026-05-08T06:00:00", "2026-05-08T07:00:00")).rejects.toThrow(
      "sync log failed",
    );

    await expect(db.timeEntries.toArray()).resolves.toHaveLength(0);
    await expect(db.syncLog.toArray()).resolves.toHaveLength(0);
  });

  it("rolls back updated entry when sync log creation fails", async () => {
    await db.timeEntries.add(entry("existing", "2026-05-08T06:00:00", "2026-05-08T07:00:00"));
    vi.spyOn(db.syncLog, "add").mockRejectedValueOnce(new Error("sync log failed"));
    const { updateEntry } = useEntryMutations();

    await expect(updateEntry("existing", { note: "changed" })).rejects.toThrow("sync log failed");

    await expect(db.timeEntries.get("existing")).resolves.toMatchObject({
      note: null,
      updatedAt: "2026-05-08T00:00:00.000Z",
    });
    await expect(db.syncLog.toArray()).resolves.toHaveLength(0);
  });

  it("rolls back deleted entry when sync log creation fails", async () => {
    await db.timeEntries.add(entry("existing", "2026-05-08T06:00:00", "2026-05-08T07:00:00"));
    vi.spyOn(db.syncLog, "add").mockRejectedValueOnce(new Error("sync log failed"));
    const { deleteEntry } = useEntryMutations();

    await expect(deleteEntry("existing")).rejects.toThrow("sync log failed");

    await expect(db.timeEntries.get("existing")).resolves.toMatchObject({ id: "existing" });
    await expect(db.syncLog.toArray()).resolves.toHaveLength(0);
  });
});

describe("findOverlappingEntries", () => {
  it("finds local entries overlapping a range and excludes the current entry", async () => {
    await db.timeEntries.bulkAdd([
      entry({ id: "before", startTime: "2026-05-07T20:00:00", endTime: "2026-05-07T22:00:00" }),
      entry({ id: "overlap", startTime: "2026-05-08T05:00:00", endTime: "2026-05-08T07:00:00" }),
      entry({ id: "self", startTime: "2026-05-08T01:00:00", endTime: "2026-05-08T02:00:00" }),
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
      entry("old", "2026-05-07T12:00:00.000Z", "2026-05-07T13:00:00.000Z"), // 上海 20:00–21:00 on May 7
      entry("latest", "2026-05-07T14:00:00.000Z", "2026-05-07T15:30:00.000Z"), // 上海 22:00–23:30 on May 7
      entry("today", "2026-05-07T17:00:00.000Z", "2026-05-07T18:00:00.000Z"), // 上海 01:00–02:00 on May 8
    ]);

    await expect(findPreviousEntry("2026-05-08")).resolves.toMatchObject({
      id: "latest",
      endTime: "2026-05-07T15:30:00.000Z",
    });
  });

  it("returns a previous-day entry that overlaps the selected day", async () => {
    await db.timeEntries.bulkAdd([
      entry("old", "2026-05-07T12:00:00.000Z", "2026-05-07T13:00:00.000Z"), // 上海 20:00–21:00 on May 7
      entry("overnight", "2026-05-07T15:57:00.000Z", "2026-05-07T22:00:00.000Z"), // 上海 23:57 May 7 – 06:00 May 8
      entry("today", "2026-05-07T23:00:00.000Z", "2026-05-08T00:00:00.000Z"), // 上海 07:00–08:00 on May 8
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
      entry("old", "2026-05-07T12:00:00.000Z", "2026-05-07T13:00:00.000Z"), // 上海 20:00–21:00 on May 7
      entry("today", "2026-05-07T23:00:00.000Z", "2026-05-08T00:00:00.000Z"), // 上海 07:00–08:00 on May 8
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
    const result = planEntryOverlapAdjustments(
      [entry("old", "2026-05-07T20:00:00", "2026-05-08T01:00:00")],
      "2026-05-07T23:00:00",
      "2026-05-08T06:00:00",
    );

    expect(result).toEqual({
      ok: true,
      updates: [{ id: "old", startTime: "2026-05-07T20:00:00", endTime: "2026-05-07T23:00:00" }],
      deletes: [],
    });
  });

  it("clips an overlapped head to the new end", () => {
    const result = planEntryOverlapAdjustments(
      [entry("old", "2026-05-08T05:00:00", "2026-05-08T07:00:00")],
      "2026-05-07T23:00:00",
      "2026-05-08T06:00:00",
    );

    expect(result).toEqual({
      ok: true,
      updates: [{ id: "old", startTime: "2026-05-08T06:00:00", endTime: "2026-05-08T07:00:00" }],
      deletes: [],
    });
  });

  it("deletes entries fully covered by the new range", () => {
    const result = planEntryOverlapAdjustments(
      [entry("old", "2026-05-08T01:00:00", "2026-05-08T02:00:00")],
      "2026-05-07T23:00:00",
      "2026-05-08T06:00:00",
    );

    expect(result).toEqual({ ok: true, updates: [], deletes: ["old"] });
  });

  it("rejects middle coverage that would require splitting one old entry", () => {
    const result = planEntryOverlapAdjustments(
      [entry("old", "2026-05-07T20:00:00", "2026-05-08T07:00:00")],
      "2026-05-07T23:00:00",
      "2026-05-08T06:00:00",
    );

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

    await expect(db.timeEntries.get("update-me")).resolves.toMatchObject({
      startTime: "2026-05-08T06:00:00",
      endTime: "2026-05-08T07:00:00",
    });
    await expect(db.timeEntries.get("delete-me")).resolves.toBeUndefined();
    await expect(db.syncLog.where("tableName").equals("time_entries").count()).resolves.toBe(2);
  });

  it("rolls back all overlap adjustments when a later sync log creation fails", async () => {
    await db.timeEntries.bulkAdd([
      entry("first", "2026-05-08T05:00:00", "2026-05-08T07:00:00"),
      entry("second", "2026-05-08T01:00:00", "2026-05-08T02:00:00"),
    ]);
    vi.spyOn(db.syncLog, "add").mockResolvedValueOnce("first-log").mockRejectedValueOnce(new Error("sync log failed"));

    await expect(
      applyEntryOverlapAdjustments({
        ok: true,
        updates: [{ id: "first", startTime: "2026-05-08T06:00:00", endTime: "2026-05-08T07:00:00" }],
        deletes: ["second"],
      }),
    ).rejects.toThrow("sync log failed");

    await expect(db.timeEntries.get("first")).resolves.toMatchObject({
      startTime: "2026-05-08T05:00:00",
      endTime: "2026-05-08T07:00:00",
    });
    await expect(db.timeEntries.get("second")).resolves.toMatchObject({ id: "second" });
    await expect(db.syncLog.toArray()).resolves.toHaveLength(0);
  });
});

describe("saveEntryWithOverlapAdjustments", () => {
  it("saves an entry and overlap adjustments in one transaction", async () => {
    await db.timeEntries.bulkAdd([
      entry({ id: "old", startTime: "2026-05-17T08:00:00.000Z", endTime: "2026-05-17T10:00:00.000Z" }),
    ]);

    const plan = planEntryOverlapAdjustments(
      await findOverlappingEntries("2026-05-17T09:00:00.000Z", "2026-05-17T11:00:00.000Z"),
      "2026-05-17T09:00:00.000Z",
      "2026-05-17T11:00:00.000Z",
    );
    expect(plan.ok).toBe(true);

    const saved = await saveEntryWithOverlapAdjustments({
      existingEntryId: null,
      categoryId: "cat-work",
      startTime: "2026-05-17T09:00:00.000Z",
      endTime: "2026-05-17T11:00:00.000Z",
      note: "new",
      overlapPlan: plan,
      now: new Date("2026-05-17T12:00:00.000Z"),
    });

    expect(saved.id).toBeTruthy();
    await expect(db.timeEntries.get("old")).resolves.toEqual(
      expect.objectContaining({ endTime: "2026-05-17T09:00:00.000Z" }),
    );
    const logs = await db.syncLog.toArray();
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tableName: "time_entries", recordId: "old", action: "update", synced: 0 }),
        expect.objectContaining({ tableName: "time_entries", recordId: saved.id, action: "create", synced: 0 }),
      ]),
    );
  });

  it("uses a single current time for validation and saved timestamps", async () => {
    const RealDate = Date;
    const firstNow = new RealDate("2026-05-17T12:00:00.000Z");
    const secondNow = new RealDate("2026-05-17T12:00:01.000Z");
    // Regular function (not arrow) so `new Date()` in source is constructable under vitest 4.
    const DateMock = vi.fn(function (this: unknown, value?: string | number | Date) {
      if (value !== undefined) return new RealDate(value);
      return DateMock.mock.calls.length === 1 ? firstNow : secondNow;
    });
    DateMock.UTC = RealDate.UTC;
    DateMock.parse = RealDate.parse;
    DateMock.now = vi.fn(() => firstNow.getTime());
    DateMock.prototype = RealDate.prototype;
    vi.stubGlobal("Date", DateMock);

    try {
      const saved = await saveEntryWithOverlapAdjustments({
        existingEntryId: null,
        categoryId: "cat-work",
        startTime: "2026-05-17T09:00:00.000Z",
        endTime: "2026-05-17T11:00:00.000Z",
        note: "new",
        overlapPlan: null,
      });

      expect(saved.createdAt).toBe(firstNow.toISOString());
      expect(saved.updatedAt).toBe(firstNow.toISOString());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rolls back overlap adjustments when the target entry cannot be saved", async () => {
    await db.timeEntries.add(
      entry({ id: "old", startTime: "2026-05-17T08:00:00.000Z", endTime: "2026-05-17T10:00:00.000Z" }),
    );
    const plan = {
      ok: true as const,
      updates: [{ id: "old", startTime: "2026-05-17T08:00:00.000Z", endTime: "2026-05-17T09:00:00.000Z" }],
      deletes: [],
    };

    await expect(
      saveEntryWithOverlapAdjustments({
        existingEntryId: "missing-entry",
        categoryId: "cat-work",
        startTime: "2026-05-17T09:00:00.000Z",
        endTime: "2026-05-17T11:00:00.000Z",
        note: null,
        overlapPlan: plan,
        now: new Date("2026-05-17T12:00:00.000Z"),
      }),
    ).rejects.toThrow("记录不存在");

    await expect(db.timeEntries.get("old")).resolves.toEqual(
      expect.objectContaining({ endTime: "2026-05-17T10:00:00.000Z" }),
    );
    await expect(db.syncLog.toArray()).resolves.toHaveLength(0);
  });
});

describe("findAdjacentEntriesForRange", () => {
  it("finds the strictly-previous and strictly-next entries by boundary equality", async () => {
    await db.timeEntries.bulkAdd([
      entry("prev", "2026-05-20T01:00:00.000Z", "2026-05-20T02:00:00.000Z"),
      entry("next", "2026-05-20T03:00:00.000Z", "2026-05-20T04:00:00.000Z"),
    ]);

    const result = await findAdjacentEntriesForRange("2026-05-20T02:00:00.000Z", "2026-05-20T03:00:00.000Z");

    expect(result.prevEntry?.id).toBe("prev");
    expect(result.nextEntry?.id).toBe("next");
  });

  it("returns null when there is a gap (not strictly adjacent)", async () => {
    await db.timeEntries.bulkAdd([
      entry("prev", "2026-05-20T01:00:00.000Z", "2026-05-20T01:59:00.000Z"),
      entry("next", "2026-05-20T03:01:00.000Z", "2026-05-20T04:00:00.000Z"),
    ]);

    const result = await findAdjacentEntriesForRange("2026-05-20T02:00:00.000Z", "2026-05-20T03:00:00.000Z");

    expect(result.prevEntry).toBeNull();
    expect(result.nextEntry).toBeNull();
  });

  it("excludes the entry being edited via excludeId", async () => {
    await db.timeEntries.bulkAdd([
      entry("self", "2026-05-20T02:00:00.000Z", "2026-05-20T03:00:00.000Z"),
      entry("prev", "2026-05-20T01:00:00.000Z", "2026-05-20T02:00:00.000Z"),
    ]);

    const result = await findAdjacentEntriesForRange("2026-05-20T02:00:00.000Z", "2026-05-20T03:00:00.000Z", "self");

    expect(result.prevEntry?.id).toBe("prev");
    expect(result.nextEntry).toBeNull();
  });
});

describe("findLatestEntryEndingBefore", () => {
  it("returns the entry with the latest endTime strictly before the cutoff", async () => {
    await db.timeEntries.bulkAdd([
      entry("a", "2026-05-15T01:00:00.000Z", "2026-05-15T02:00:00.000Z"),
      entry("b", "2026-05-15T03:00:00.000Z", "2026-05-15T05:00:00.000Z"),
      entry("c", "2026-05-15T06:00:00.000Z", "2026-05-15T07:00:00.000Z"),
    ]);

    await expect(findLatestEntryEndingBefore("2026-05-15T06:00:00.000Z")).resolves.toMatchObject({
      id: "b",
      endTime: "2026-05-15T05:00:00.000Z",
    });
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
