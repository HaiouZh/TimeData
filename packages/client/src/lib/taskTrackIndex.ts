import { latestTrackBoardSignal, type Track, type TrackBoardSignal, type TrackStep } from "@timedata/shared";
import { badgeToneForSignal, type TrackBadgeTone } from "./trackBadgeTone.js";

export interface TaskTrackInfo {
  track: Track;
  signal: TrackBoardSignal | null;
  tone: TrackBadgeTone;
}

/** 该任务当前挂载的 active 轨道：refs 含 kind="task" 的命中里取 updatedAt 最新；无则 null。 */
export function findActiveTrackForTask(tracks: readonly Track[], taskId: string): Track | null {
  let best: Track | null = null;
  for (const track of tracks) {
    if (track.status !== "active") continue;
    if (!track.refs.some((ref) => ref.kind === "task" && ref.id === taskId)) continue;
    if (best === null || track.updatedAt > best.updatedAt) best = track;
  }
  return best;
}

/**
 * task→track 读侧反查索引（tracks.refs 无索引，全表扫 + 内存过滤，个人数据量可接受——
 * 同 useTrackAttentionCount 的既有取数路径）。词表 = actionTags 与 agentExecTags 拼接，
 * 与 tracksDispatch.dispatchItems 同口径。
 */
export function buildTaskTrackIndex(
  tracks: readonly Track[],
  stepsByTrack: ReadonlyMap<string, TrackStep[]>,
  actionTags: readonly string[],
  agentExecTags: readonly string[],
): Map<string, TaskTrackInfo> {
  const boardSignals = [...actionTags, ...agentExecTags];
  const chosen = new Map<string, Track>();
  for (const track of tracks) {
    if (track.status !== "active") continue;
    for (const ref of track.refs) {
      if (ref.kind !== "task") continue;
      const prev = chosen.get(ref.id);
      if (prev === undefined || track.updatedAt > prev.updatedAt) chosen.set(ref.id, track);
    }
  }
  const index = new Map<string, TaskTrackInfo>();
  for (const [taskId, track] of chosen) {
    const signal = latestTrackBoardSignal(stepsByTrack.get(track.id) ?? [], boardSignals);
    index.set(taskId, { track, signal, tone: badgeToneForSignal(signal, actionTags, agentExecTags) });
  }
  return index;
}
