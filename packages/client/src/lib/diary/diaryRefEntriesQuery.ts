import type { TimeEntry } from "@timedata/shared";
import { db } from "../../db/index.js";
import { diaryRefDayWindow } from "./diaryRefEntries.js";

/**
 * 参考栏打点块专用的当天窗口查询。**不复用 `useEntries(date)`**：那个 hook 内部还有第二条
 * `previousEntry` 的近全表扫描（`where("startTime").below(now)`），本块一个字段都不用，
 * 每次挂载/切日期却要白付一倍读取；它还把「查询未回」的 `undefined` 兜底成 `[]`，
 * 会让本块在加载中把空态文案当事实说出来。
 *
 * 单独成文件、不与 `diaryRefEntries.ts` 合并，是为了守住测试分桶：`diaryRefEntries.ts` 的
 * 纯函数测试跑在 node 干净桶（零 DOM、零 db），那个桶的前提是**模块图里不出现 db**。
 * 碰 db 的查询留在这里，与 `lib/quickNotes.ts`（碰 db）和 `lib/quick-notes/**`（纯逻辑进干净桶）
 * 的既有分法同源。
 */
export async function listEntriesOverlappingDay(date: string): Promise<TimeEntry[]> {
  const { dayStart, dayEnd } = diaryRefDayWindow(date);
  const candidates = await db.timeEntries.where("startTime").below(dayEnd).toArray();
  return candidates.filter((entry) => entry.endTime > dayStart);
}
