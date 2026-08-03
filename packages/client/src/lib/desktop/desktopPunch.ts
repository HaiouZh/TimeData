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

/**
 * 热键打点的「先看再写」（spec §五.5）：算区间→校验分类→比阈值，超阈值不落笔，
 * 交给确认卡。now 一律用按键那一刻（pressedAtMs），排队补投也不歪。
 */
export async function desktopPunch(pressedAtMs: number, confirmHours: number): Promise<DesktopPunchOutcome> {
  const pressedAt = new Date(Math.floor(pressedAtMs / 60000) * 60000);
  const nowUtc = pressedAt.toISOString();
  const todayStartUtc = localDateTimeToUtc(`${getDateString(pressedAt)}T00:00:00`);
  const lastEntry = await findLatestEntryEndingBefore(new Date(pressedAt.getTime() + 1).toISOString());
  const range = resolvePunchRange(nowUtc, todayStartUtc, lastEntry?.endTime ?? null);
  if (!range) return { kind: "noRange" };
  if (!(await resolveConfiguredPunchCategoryId())) return { kind: "missingCategory" };

  const rangeHours = (new Date(range.endTime).getTime() - new Date(range.startTime).getTime()) / 3_600_000;
  if (rangeHours > confirmHours) return { kind: "needsConfirm", range };
  return writePunch(pressedAtMs);
}

/**
 * 真正落笔（阈值内直写；确认卡「记录」也走这里）。按当下数据重算区间——
 * 确认卡上的区间只是预览，同步刚拉完时写入的是缩短后的准确区间，只会更准不会更歪。
 */
export async function writePunch(pressedAtMs: number): Promise<Exclude<DesktopPunchOutcome, { kind: "needsConfirm" }>> {
  const result = await punchNow(new Date(pressedAtMs));
  if (!result.ok) {
    return result.reason === "no_range" ? { kind: "noRange" } : { kind: "missingCategory" };
  }
  return { kind: "written", entry: result.entry };
}
