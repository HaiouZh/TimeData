import type { Category, TimeEntry } from "@timedata/shared";
import { INSIGHT_CONSTANTS } from "./constants.js";
import type { InsightSession } from "./types.js";

// 子分类归到父分类；父分类用自身 id；未知分类归 "unknown"。
export function resolveParentId(entry: TimeEntry, categoryById: Map<string, Category>): string {
  const category = categoryById.get(entry.categoryId);
  if (!category) return "unknown";
  if (category.parentId) {
    return categoryById.has(category.parentId) ? category.parentId : "unknown";
  }
  return category.id;
}

const toMs = (iso: string) => new Date(iso).getTime();

// 同父分类、相邻间隙 <= 容差 的连续条目合并成一段会话。durationMin = 末 end - 首 start（含小间隙）。
export function buildSessions(entries: TimeEntry[], categories: Category[]): InsightSession[] {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const sorted = [...entries].sort((a, b) => toMs(a.startTime) - toMs(b.startTime));
  const toleranceMs = INSIGHT_CONSTANTS.sessionMergeToleranceMin * 60000;

  const sessions: InsightSession[] = [];
  let current: (InsightSession & { endMs: number }) | null = null;

  for (const entry of sorted) {
    const parentId = resolveParentId(entry, categoryById);
    const startMs = toMs(entry.startTime);
    const endMs = toMs(entry.endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    if (current && parentId === current.parentId && startMs - current.endMs <= toleranceMs) {
      current.endMs = Math.max(current.endMs, endMs);
      current.endTime = new Date(current.endMs).toISOString();
      current.entryIds.push(entry.id);
      current.durationMin = (current.endMs - toMs(current.startTime)) / 60000;
    } else {
      if (current) sessions.push(stripEndMs(current));
      current = {
        parentId,
        startTime: entry.startTime,
        endTime: entry.endTime,
        entryIds: [entry.id],
        durationMin: (endMs - startMs) / 60000,
        endMs,
      };
    }
  }
  if (current) sessions.push(stripEndMs(current));
  return sessions;
}

function stripEndMs(session: InsightSession & { endMs: number }): InsightSession {
  const { endMs: _endMs, ...rest } = session;
  return rest;
}
