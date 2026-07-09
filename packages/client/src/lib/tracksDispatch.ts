// tracks 调度台纯函数层：状态卡分组/停滞判定/统计带。不碰 db/DOM，node 快桶可测。
import { latestTrackBoardSignal, type Track, type TrackBoardSignal, type TrackStep } from "@timedata/shared";
import { lastActivityAt, latestStep } from "./tracksView.js";

const DAY_MS = 86_400_000;
export const STALL_THRESHOLD_MS = 7 * DAY_MS;

export type DispatchGroupKey = "awaiting-me" | "agent-running" | "in-progress" | "stalled";

export const DISPATCH_GROUP_LABELS: Record<DispatchGroupKey, string> = {
  "awaiting-me": "等我接",
  "agent-running": "agent 在跑",
  "in-progress": "推进中",
  stalled: "停滞",
};

// 显示序：等我接最上，停滞沉底弱化。
const GROUP_ORDER: DispatchGroupKey[] = ["awaiting-me", "agent-running", "in-progress", "stalled"];

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

// 分组判定优先级：等我接 > 停滞 > agent在跑 > 推进中。
// - 等我接不被停滞豁免；#agent在做 挂超阈值 = agent 早不跑了，归停滞；
// - 信号口径 = latestTrackBoardSignal（最近一个带信号的步，同导航 badge / goals 候选口径），
//   中途补一条无信号步不清除在场信号；
// - 等我接约定 = 第一个看板信号（actionTags[0]），其余看板信号只作徽章、归推进中。
function classify(
  signal: TrackBoardSignal | null,
  stalled: boolean,
  awaitTag: string | null,
  agentExecTags: readonly string[],
): DispatchGroupKey {
  if (awaitTag !== null && signal?.tag === awaitTag) return "awaiting-me";
  if (stalled) return "stalled";
  if (signal !== null && agentExecTags.includes(signal.tag)) return "agent-running";
  return "in-progress";
}

export function dispatchItems(
  tracks: Track[],
  stepsByTrack: Map<string, TrackStep[]>,
  actionTags: readonly string[],
  agentExecTags: readonly string[],
  now: Date,
): DispatchItem[] {
  const awaitTag = actionTags[0] ?? null;
  const boardSignals = [...actionTags, ...agentExecTags];
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
      group: classify(signal, stalled, awaitTag, agentExecTags),
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
  stalled: number;
} {
  let awaiting = 0;
  let agentRunning = 0;
  let stalled = 0;
  for (const item of items) {
    if (item.group === "awaiting-me") awaiting += 1;
    else if (item.group === "agent-running") agentRunning += 1;
    else if (item.group === "stalled") stalled += 1;
  }
  return { awaiting, agentRunning, stalled };
}
