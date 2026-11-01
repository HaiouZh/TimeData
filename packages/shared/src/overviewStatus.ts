/** 全貌口径：近期窗口天数。 */
export const OVERVIEW_RECENT_DAYS = 7;
/** 全貌口径：星沉进暗处的天数。 */
export const OVERVIEW_DARK_DAYS = 14;
/** 全貌口径：做完窗口天数（后续任务消费）。 */
export const OVERVIEW_DONE_WINDOW_DAYS = 30;
/** 标题项目名前缀最大字符数。 */
export const OVERVIEW_TITLE_PREFIX_MAX_CHARS = 40;

/** 星的种类。 */
export type OverviewStarKind = "input" | "done" | "progress" | "recurring";
/** 团状态。 */
export type OverviewClusterStatus = "moving" | "saving" | "shelved" | "fixed" | "empty";

/** 团状态判定用的动静。 */
export interface OverviewStatusEvent {
  kind: OverviewStarKind;
  at: string;
}
/** 团状态判定结果。 */
export interface OverviewClusterStatusResult {
  status: OverviewClusterStatus;
  lastActivityAt: string | null;
  quietDays: number | null;
}

const DAY_MS = 86_400_000;

/** 每种星在团状态里算什么：推进、在攒，或只是固定重复（不算动静）。新加星种时这里必须补一格。 */
const OVERVIEW_STATUS_ROLE: Record<OverviewStarKind, "moving" | "saving" | "fixed"> = {
  input: "saving",
  done: "moving",
  progress: "moving",
  recurring: "fixed",
};

/** 时刻是否落在以 now 为终点的滚动窗口内（含边界，未来时刻自然为真）。 */
export function isWithinOverviewDays(at: string, now: Date, days: number): boolean {
  return now.getTime() - Date.parse(at) <= days * DAY_MS;
}

/** 按真实时刻取最晚那条 event 的 at 原串。 */
function latestAt(events: readonly OverviewStatusEvent[]): string {
  let best = events[0] as OverviewStatusEvent;
  let bestMs = Date.parse(best.at);
  for (let i = 1; i < events.length; i++) {
    const cur = events[i] as OverviewStatusEvent;
    const ms = Date.parse(cur.at);
    if (ms > bestMs) {
      best = cur;
      bestMs = ms;
    }
  }
  return best.at;
}

/** 一团事情当前算哪一种状态。 */
export function computeOverviewClusterStatus(input: {
  events: readonly OverviewStatusEvent[];
  now: Date;
}): OverviewClusterStatusResult {
  const { events, now } = input;
  if (events.length === 0) {
    return { status: "empty", lastActivityAt: null, quietDays: null };
  }
  const active = events.filter((e) => OVERVIEW_STATUS_ROLE[e.kind] !== "fixed");
  if (active.length === 0) {
    const lastActivityAt = latestAt(events);
    return {
      status: "fixed",
      lastActivityAt,
      quietDays: Math.max(0, Math.floor((now.getTime() - Date.parse(lastActivityAt)) / DAY_MS)),
    };
  }
  const lastActivityAt = latestAt(active);
  const recent = (role: "moving" | "saving"): boolean =>
    active.some((e) => OVERVIEW_STATUS_ROLE[e.kind] === role && isWithinOverviewDays(e.at, now, OVERVIEW_RECENT_DAYS));
  const status: OverviewClusterStatus = recent("moving") ? "moving" : recent("saving") ? "saving" : "shelved";
  return {
    status,
    lastActivityAt,
    quietDays: Math.max(0, Math.floor((now.getTime() - Date.parse(lastActivityAt)) / DAY_MS)),
  };
}

/** 没归团没置顶且超过暗处窗口的星沉进暗处。 */
export function isOverviewStarDark(input: { assigned: boolean; pinned: boolean; at: string; now: Date }): boolean {
  if (input.assigned || input.pinned) return false;
  return !isWithinOverviewDays(input.at, input.now, OVERVIEW_DARK_DAYS);
}

/** 取标题里第一个分隔符之前的项目名前缀，不合口径返回 null。 */
export function overviewTitlePrefix(title: string): string | null {
  const idx = title.indexOf(" · ");
  if (idx < 0) return null;
  const prefix = title.slice(0, idx).trim();
  if (prefix === "") return null;
  if (prefix.length > OVERVIEW_TITLE_PREFIX_MAX_CHARS) return null;
  return prefix;
}
