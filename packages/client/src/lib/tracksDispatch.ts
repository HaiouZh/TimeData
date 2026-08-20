// tracks 调度台纯函数层：状态卡分组/统计带。不碰 db/DOM，node 快桶可测。
// 分组由显式信号决定，停滞退出分组判定、只作 stalledDays 提醒——信号是用户宣告的，系统只提醒不改判。
// resumeTags 为恢复推进信号：并入 boardSignals 成为信号步，命中时不进前三组、落回兜底推进中（用于从等外部/等我接/agent在跑切回的出口）。
import { latestTrackBoardSignal, type Track, type TrackBoardSignal, type TrackStep } from "@timedata/shared";
import { lastActivityAt, latestStep } from "./tracksView.js";

const DAY_MS = 86_400_000;
export const STALL_THRESHOLD_MS = 7 * DAY_MS;

export type DispatchGroupKey = "awaiting-me" | "agent-running" | "wait-external" | "in-progress";

export const DISPATCH_GROUP_LABELS: Record<DispatchGroupKey, string> = {
  "awaiting-me": "等我接",
  "agent-running": "agent 在跑",
  "wait-external": "等外部",
  "in-progress": "推进中",
};

// 显示序：等我接最上，推进中沉底。
const GROUP_ORDER: DispatchGroupKey[] = ["awaiting-me", "agent-running", "wait-external", "in-progress"];

export interface DispatchItem {
  track: Track;
  latest: TrackStep | null;
  signal: TrackBoardSignal | null;
  lastActivityAt: string | null;
  // 超停滞阈值时为整天数（等我接组也标——等了 13 天更要显眼），否则 null。
  stalledDays: number | null;
  group: DispatchGroupKey;
}

export interface DispatchGroup {
  key: DispatchGroupKey;
  label: string;
  items: DispatchItem[];
}

// 分组判定优先级：等我接 > agent在跑 > 等外部 > 推进中。
// 停滞退出分组判定、只作 stalledDays 提醒——信号是用户宣告的，系统只提醒不改判。
// - 等我接约定 = 第一个看板信号（actionTags[0]），其余看板信号只作徽章、归推进中；
// - 信号口径 = latestTrackBoardSignal（最近一个带信号的步，同导航 badge / goals 候选口径），
//   中途补一条无信号步不清除在场信号。
function classify(
  signal: TrackBoardSignal | null,
  awaitTag: string | null,
  agentExecTags: readonly string[],
  waitExternalTags: readonly string[],
): DispatchGroupKey {
  if (awaitTag !== null && signal?.tag === awaitTag) return "awaiting-me";
  if (signal !== null && agentExecTags.includes(signal.tag)) return "agent-running";
  if (signal !== null && waitExternalTags.includes(signal.tag)) return "wait-external";
  return "in-progress";
}

export function dispatchItems(
  tracks: Track[],
  stepsByTrack: Map<string, TrackStep[]>,
  actionTags: readonly string[],
  agentExecTags: readonly string[],
  waitExternalTags: readonly string[],
  resumeTags: readonly string[],
  now: Date,
): DispatchItem[] {
  const awaitTag = actionTags[0] ?? null;
  const boardSignals = [...actionTags, ...agentExecTags, ...waitExternalTags, ...resumeTags];
  return tracks.map((track) => {
    const steps = stepsByTrack.get(track.id) ?? [];
    const activityAt = lastActivityAt(steps);
    // 无步轨道用创建时刻兜底：新建后一直没动笔同样算停滞。
    const idleMs = now.getTime() - new Date(activityAt ?? track.createdAt).getTime();
    const stalled = idleMs > STALL_THRESHOLD_MS;
    const signal = latestTrackBoardSignal(steps, boardSignals);
    return {
      track,
      latest: latestStep(steps),
      signal,
      lastActivityAt: activityAt,
      stalledDays: stalled ? Math.floor(idleMs / DAY_MS) : null,
      group: classify(signal, awaitTag, agentExecTags, waitExternalTags),
    };
  });
}

export function groupDispatchItems(items: readonly DispatchItem[]): DispatchGroup[] {
  return GROUP_ORDER.map((key) => ({
    key,
    label: DISPATCH_GROUP_LABELS[key],
    items: items
      .filter((item) => item.group === key)
      .sort((a, b) => {
        const aMs = a.lastActivityAt === null ? 0 : new Date(a.lastActivityAt).getTime();
        const bMs = b.lastActivityAt === null ? 0 : new Date(b.lastActivityAt).getTime();
        return bMs - aMs;
      }),
  })).filter((group) => group.items.length > 0);
}

export function dispatchStats(items: readonly DispatchItem[]): {
  awaiting: number;
  agentRunning: number;
  waitingExternal: number;
  stalled: number;
} {
  let awaiting = 0;
  let agentRunning = 0;
  let waitingExternal = 0;
  let stalled = 0;
  for (const item of items) {
    if (item.group === "awaiting-me") awaiting += 1;
    else if (item.group === "agent-running") agentRunning += 1;
    else if (item.group === "wait-external") waitingExternal += 1;
    if (item.stalledDays !== null) stalled += 1;
  }
  return { awaiting, agentRunning, waitingExternal, stalled };
}
