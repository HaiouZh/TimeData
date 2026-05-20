import type { TimeEntry } from "@timedata/shared";
import { localDateTimeToUtc } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.ts";
import { addDays, isFutureLocalDateTime } from "../lib/time.ts";
import { recordSyncLog } from "../sync/engine.ts";

function dayBounds(date: string) {
  return {
    dayStart: localDateTimeToUtc(`${date}T00:00:00`),
    dayEnd: localDateTimeToUtc(`${addDays(date, 1)}T00:00:00`),
  };
}

export interface EntryOverlapUpdate {
  id: string;
  startTime: string;
  endTime: string;
}

export type EntryOverlapPlan =
  | { ok: true; updates: EntryOverlapUpdate[]; deletes: string[] }
  | { ok: false; blockedEntryId: string };

export function validateEntryTimeRange(startTime: string, endTime: string, now: Date = new Date()): void {
  if (endTime <= startTime) throw new Error("结束时间必须晚于开始时间");
  if (isFutureLocalDateTime(endTime, now)) throw new Error("不能记录尚未发生的时间");
}

export interface FutureEndedEntriesDeleteResult {
  deletedCount: number;
  deletedEntryIds: string[];
}

export async function findFutureEndedEntries(now: Date = new Date()): Promise<TimeEntry[]> {
  const entries = await db.timeEntries.toArray();
  return entries
    .filter((entry) => isFutureLocalDateTime(entry.endTime, now))
    .sort((a, b) => a.endTime.localeCompare(b.endTime));
}

export async function deleteFutureEndedEntries(now: Date = new Date()): Promise<FutureEndedEntriesDeleteResult> {
  const entries = await findFutureEndedEntries(now);
  const deletedEntryIds = entries.map((entry) => entry.id);
  if (deletedEntryIds.length === 0) return { deletedCount: 0, deletedEntryIds: [] };

  await db.transaction("rw", db.timeEntries, db.syncLog, async () => {
    for (const id of deletedEntryIds) {
      await db.timeEntries.delete(id);
      const pendingLogs = await db.syncLog
        .where("recordId")
        .equals(id)
        .filter((log) => log.tableName === "time_entries" && !log.synced)
        .toArray();
      if (pendingLogs.some((log) => log.action === "create")) {
        await db.syncLog.bulkUpdate(pendingLogs.map((log) => ({ key: log.id, changes: { synced: 1 } })));
      } else {
        await recordSyncLog("time_entries", id, "delete");
      }
    }
  });

  return { deletedCount: deletedEntryIds.length, deletedEntryIds };
}

export async function findOverlappingEntries(
  startTime: string,
  endTime: string,
  excludeId?: string,
): Promise<TimeEntry[]> {
  const candidates = await db.timeEntries.where("startTime").below(endTime).toArray();
  return candidates
    .filter((entry) => entry.id !== excludeId && entry.endTime > startTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function findPreviousEntry(date: string): Promise<TimeEntry | null> {
  const dayStart = localDateTimeToUtc(`${date}T00:00:00`);
  const previousEntries = await db.timeEntries.where("startTime").below(dayStart).toArray();
  const overlapping = previousEntries
    .filter((entry) => entry.endTime > dayStart)
    .sort((a, b) => b.endTime.localeCompare(a.endTime));
  if (overlapping.length > 0) return overlapping[0];

  const previousDayStart = localDateTimeToUtc(`${addDays(date, -1)}T00:00:00`);
  return (
    previousEntries
      .filter((entry) => entry.endTime >= previousDayStart)
      .sort((a, b) => b.endTime.localeCompare(a.endTime))[0] || null
  );
}

export async function findLatestEntryEndingBefore(utcCutoff: string): Promise<TimeEntry | null> {
  return (await db.timeEntries.where("endTime").below(utcCutoff).reverse().first()) ?? null;
}

export function useLatestEntryEndTimeBefore(utcCutoff: string | null): string | null {
  return useLiveQuery(
    async () => {
      if (!utcCutoff) return null;
      const entry = await findLatestEntryEndingBefore(utcCutoff);
      return entry?.endTime ?? null;
    },
    [utcCutoff],
    null,
  );
}

export function planEntryOverlapAdjustments(
  overlaps: TimeEntry[],
  startTime: string,
  endTime: string,
): EntryOverlapPlan {
  const updates: EntryOverlapUpdate[] = [];
  const deletes: string[] = [];

  for (const entry of overlaps) {
    const coversWholeEntry = startTime <= entry.startTime && endTime >= entry.endTime;
    const coversMiddle = startTime > entry.startTime && endTime < entry.endTime;

    if (coversWholeEntry) {
      deletes.push(entry.id);
    } else if (coversMiddle) {
      return { ok: false, blockedEntryId: entry.id };
    } else if (entry.startTime < startTime) {
      updates.push({ id: entry.id, startTime: entry.startTime, endTime: startTime });
    } else {
      updates.push({ id: entry.id, startTime: endTime, endTime: entry.endTime });
    }
  }

  return { ok: true, updates, deletes };
}

export async function applyEntryOverlapAdjustments(plan: Extract<EntryOverlapPlan, { ok: true }>): Promise<void> {
  const now = new Date().toISOString();

  await db.transaction("rw", db.timeEntries, db.syncLog, async () => {
    for (const update of plan.updates) {
      await db.timeEntries.update(update.id, { startTime: update.startTime, endTime: update.endTime, updatedAt: now });
      await recordSyncLog("time_entries", update.id, "update");
    }

    for (const id of plan.deletes) {
      await db.timeEntries.delete(id);
      await recordSyncLog("time_entries", id, "delete");
    }
  });
}

export interface SaveEntryWithOverlapAdjustmentsInput {
  existingEntryId: string | null;
  categoryId: string;
  startTime: string;
  endTime: string;
  note: string | null;
  overlapPlan: Extract<EntryOverlapPlan, { ok: true }> | null;
  now?: Date;
}

export async function saveEntryWithOverlapAdjustments(input: SaveEntryWithOverlapAdjustmentsInput): Promise<TimeEntry> {
  const nowDate = input.now ?? new Date();
  validateEntryTimeRange(input.startTime, input.endTime, nowDate);
  const now = nowDate.toISOString();

  return db.transaction("rw", db.timeEntries, db.syncLog, async () => {
    if (input.overlapPlan) {
      for (const update of input.overlapPlan.updates) {
        await db.timeEntries.update(update.id, {
          startTime: update.startTime,
          endTime: update.endTime,
          updatedAt: now,
        });
        await recordSyncLog("time_entries", update.id, "update");
      }
      for (const id of input.overlapPlan.deletes) {
        await db.timeEntries.delete(id);
        await recordSyncLog("time_entries", id, "delete");
      }
    }

    if (input.existingEntryId) {
      const existing = await db.timeEntries.get(input.existingEntryId);
      if (!existing) throw new Error("记录不存在");
      const entry: TimeEntry = {
        ...existing,
        categoryId: input.categoryId,
        startTime: input.startTime,
        endTime: input.endTime,
        note: input.note,
        updatedAt: now,
      };
      await db.timeEntries.put(entry);
      await recordSyncLog("time_entries", entry.id, "update");
      return entry;
    }

    const entry: TimeEntry = {
      id: uuid(),
      categoryId: input.categoryId,
      startTime: input.startTime,
      endTime: input.endTime,
      note: input.note,
      createdAt: now,
      updatedAt: now,
    };
    await db.timeEntries.add(entry);
    await recordSyncLog("time_entries", entry.id, "create");
    return entry;
  });
}

export function useEntry(id?: string) {
  return useLiveQuery(() => (id ? db.timeEntries.get(id) : undefined), [id]);
}

export function useEntryMutations() {
  async function addEntry(categoryId: string, startTime: string, endTime: string, note?: string): Promise<void> {
    const now = new Date().toISOString();
    const id = uuid();

    validateEntryTimeRange(startTime, endTime);

    const entry: TimeEntry = {
      id,
      categoryId,
      startTime,
      endTime,
      note: note || null,
      createdAt: now,
      updatedAt: now,
    };

    await db.transaction("rw", db.timeEntries, db.syncLog, async () => {
      await db.timeEntries.add(entry);
      await recordSyncLog("time_entries", id, "create");
    });
  }

  async function updateEntry(
    id: string,
    updates: Partial<Pick<TimeEntry, "categoryId" | "startTime" | "endTime" | "note">>,
  ): Promise<void> {
    if (updates.startTime || updates.endTime) {
      const existing = await db.timeEntries.get(id);
      const nextStartTime = updates.startTime || existing?.startTime;
      const nextEndTime = updates.endTime || existing?.endTime;
      if (nextStartTime && nextEndTime) validateEntryTimeRange(nextStartTime, nextEndTime);
    }

    const now = new Date().toISOString();
    await db.transaction("rw", db.timeEntries, db.syncLog, async () => {
      await db.timeEntries.update(id, { ...updates, updatedAt: now });
      await recordSyncLog("time_entries", id, "update");
    });
  }

  async function deleteEntry(id: string): Promise<void> {
    await db.transaction("rw", db.timeEntries, db.syncLog, async () => {
      await db.timeEntries.delete(id);
      await recordSyncLog("time_entries", id, "delete");
    });
  }

  return { addEntry, updateEntry, deleteEntry };
}

export function useEntries(date: string) {
  const { dayStart, dayEnd } = dayBounds(date);
  const entries =
    useLiveQuery(async () => {
      const candidates = await db.timeEntries.where("startTime").below(dayEnd).toArray();
      return candidates
        .filter((entry) => entry.endTime > dayStart)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
    }, [dayStart, dayEnd]) || [];
  const previousEntry =
    useLiveQuery(async () => {
      return findPreviousEntry(date);
    }, [date]) || null;
  const mutations = useEntryMutations();

  return { entries, previousEntry, ...mutations };
}
