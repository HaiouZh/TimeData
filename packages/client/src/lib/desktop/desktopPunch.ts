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
 *
 * ⚠️ 下面这四行区间推导是 `punch.ts` 的 `punchNow` 里那四行的**复刻**（取整到分钟 → 今天 0 点
 * → 查最后一条 → resolvePunchRange）。两处必须同规：确认卡上给用户看的区间、以及那道
 * 「不超过已批准长度」的自守闸，都是这里算的，而真正落笔的是 `punchNow` 自己重算的。
 * 分叉了不会「算错」，而是**守门员守错了对象**。`desktopPunch.test.ts` 里有一条跨文件
 * 一致性用例钉住这件事，改任何一侧的推导规则都要两处一起改。
 */
export async function desktopPunch(pressedAtMs: number, maxHours: number): Promise<DesktopPunchOutcome> {
  const pressedAt = new Date(Math.floor(pressedAtMs / 60000) * 60000);
  const nowUtc = pressedAt.toISOString();
  const todayStartUtc = localDateTimeToUtc(`${getDateString(pressedAt)}T00:00:00`);
  const lastEntry = await findLatestEntryEndingBefore(new Date(pressedAt.getTime() + 1).toISOString());
  const range = resolvePunchRange(nowUtc, todayStartUtc, lastEntry?.endTime ?? null);
  if (!range) return { kind: "noRange" };
  if (!(await resolveConfiguredPunchCategoryId())) return { kind: "missingCategory" };
  // 写成否定式而不是 `> maxHours`：NaN 的一切比较都是 false，正向写法会让守门员
  // 在 maxHours 为 NaN（调用方分支写歪）或 range 含非法 ISO 时静默放行。失败要 fail-closed。
  if (!(rangeHours(range) <= maxHours)) return { kind: "needsConfirm", range };

  const result = await punchNow(pressedAt);
  if (!result.ok) {
    // 穷尽 switch + never，不用二元三目：`punchNow` 今天恰好只有两个失败原因，
    // 而 §4.5 已把下一步钉死（把「读锚点 + 写打点」合成原子操作），那次改造几乎一定会加
    // 第三种原因。三目会把它静默映射成 missingCategory——用户收到「请先在设置里选择打点分类」
    // 这句与真实原因无关的话，且没有任何测试会红。现在加原因就编译报错。
    switch (result.reason) {
      case "no_range":
        return { kind: "noRange" };
      case "missing_category":
        return { kind: "missingCategory" };
      default: {
        const unhandled: never = result.reason;
        throw new Error(`desktopPunch 不认识 punchNow 的失败原因：${String(unhandled)}`);
      }
    }
  }
  return { kind: "written", entry: result.entry };
}
