import { localDateTimeToUtc } from "@timedata/shared";
import type { TimeEntry } from "@timedata/shared";
import { findLatestEntryEndingBefore } from "../../hooks/useEntries.js";
import {
  punchNow,
  resolveConfiguredPunchCategoryId,
  resolvePunchRange,
  type PunchRange,
} from "../punch.js";
import { getDateString } from "../time.js";

export type DesktopPunchOutcome =
  | { kind: "written"; entry: TimeEntry }
  | { kind: "needsConfirm"; range: PunchRange }
  | { kind: "noRange" }
  | { kind: "missingCategory" };

/** 区间小时数——调用方拿它把「用户已批准的长度」传回来，保证两边算法同源。 */
export function rangeHours(range: PunchRange): number {
  return (new Date(range.endTime).getTime() - new Date(range.startTime).getTime()) / 3_600_000;
}

/**
 * 热键打点（spec §五.5）：每次都按**当下数据**重算区间，绝不写下超过 maxHours 的区间。
 * - 首次按键：maxHours = 配置的确认阈值。
 * - 用户在确认卡上批准后重试：maxHours = 批准的那个区间长度（rangeHours(range)）。
 *   这样「批准期间数据变了导致区间变长」会再弹一次卡，而不是闷头写下用户没看过的区间
 *   （同步会传播删除，重算只保证更准是错的）。区间变短则直接写，仍是更准。
 */
export async function desktopPunch(pressedAtMs: number, maxHours: number): Promise<DesktopPunchOutcome> {
  const pressedAt = new Date(Math.floor(pressedAtMs / 60000) * 60000);
  const nowUtc = pressedAt.toISOString();
  const todayStartUtc = localDateTimeToUtc(`${getDateString(pressedAt)}T00:00:00`);
  const lastEntry = await findLatestEntryEndingBefore(new Date(pressedAt.getTime() + 1).toISOString());
  const range = resolvePunchRange(nowUtc, todayStartUtc, lastEntry?.endTime ?? null);
  if (!range) return { kind: "noRange" };
  if (!(await resolveConfiguredPunchCategoryId())) return { kind: "missingCategory" };
  if (rangeHours(range) > maxHours) return { kind: "needsConfirm", range };

  const result = await punchNow(pressedAt);
  if (!result.ok) {
    return result.reason === "no_range" ? { kind: "noRange" } : { kind: "missingCategory" };
  }
  return { kind: "written", entry: result.entry };
}
