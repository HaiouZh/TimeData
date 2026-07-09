import {
  compareTrackStepsBySemanticTime,
  compareTrackStepsBySemanticTimeDesc,
  latestTrackBoardSignal,
  latestOpenStep as latestOpenTrackStep,
  latestTrackStep,
  uniqueTrackBoardSignals,
  type Ref,
  type Track,
  type TrackBoardSignal,
  type TrackStep,
} from "@timedata/shared";
import { formatMinutesDuration } from "./time.js";

const MS_PER_DAY = 86_400_000;

export function groupStepsByTrack(steps: TrackStep[]): Map<string, TrackStep[]> {
  const grouped = new Map<string, TrackStep[]>();
  for (const step of steps) {
    const list = grouped.get(step.trackId);
    if (list) list.push(step);
    else grouped.set(step.trackId, [step]);
  }
  for (const list of grouped.values()) list.sort(compareTrackStepsBySemanticTime);
  return grouped;
}

export function currentStepId(steps: TrackStep[]): string | null {
  return latestOpenTrackStep(steps)?.id ?? null;
}

export function latestStep(steps: TrackStep[]): TrackStep | null {
  return latestTrackStep(steps);
}

export function latestStepId(steps: TrackStep[]): string | null {
  return latestStep(steps)?.id ?? null;
}

// 轨道「最后活动」时刻：取最新一步，闭合步用结束、开口步用开始。用于卡片相对时间。
export function lastActivityAt(steps: TrackStep[]): string | null {
  const step = latestStep(steps);
  if (!step) return null;
  return step.endedAt ?? step.startedAt;
}

export function orderedTimeline(steps: TrackStep[]): TrackStep[] {
  const currentId = currentStepId(steps);
  return [...steps].sort((a, b) => {
    if (a.id === currentId) return -1;
    if (b.id === currentId) return 1;
    return compareTrackStepsBySemanticTimeDesc(a, b);
  });
}

export function partitionTracks(tracks: Track[]): { active: Track[]; archived: Track[] } {
  const active: Track[] = [];
  const archived: Track[] = [];
  for (const t of tracks) {
    if (t.status === "active") active.push(t);
    else archived.push(t);
  }
  return { active, archived };
}

export function formatStepDuration(startedAt: string, endedAt: string | null, now: Date): string {
  const end = endedAt === null ? now.getTime() : new Date(endedAt).getTime();
  const ms = Math.max(0, end - new Date(startedAt).getTime());
  if (ms >= MS_PER_DAY) {
    const days = Math.floor(ms / MS_PER_DAY);
    const hours = Math.floor((ms % MS_PER_DAY) / 3_600_000);
    return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
  }
  return formatMinutesDuration(ms / 60_000);
}

// 外链判定:仅 id 为 http(s) 才算可点外链。kind 不参与放行——url 型 ref 的 id 同样须带 http(s) 协议。
// 用协议白名单而非信任 kind,避免 javascript:/data: 等危险协议被塞进 RefChip 的 href 触发自 XSS
// (与 quick-notes 经 rehype-sanitize 处理用户 URL 的安全姿态一致)。
export function isLinkRef(ref: Ref): boolean {
  return /^https?:\/\//i.test(ref.id);
}

export function stepSourceText(step: TrackStep): string {
  if (step.source === "user") return "我";
  return step.sourceLabel ?? "agent";
}

export interface TrackStatusFacet {
  tag: string;
  count: number;
  suggested: boolean;
}

export type { TrackBoardSignal };

export interface TrackBoardItem {
  track: Track;
  signal: TrackBoardSignal | null;
}

export function latestBoardSignal(steps: TrackStep[], boardSignals: readonly string[]): TrackBoardSignal | null {
  return latestTrackBoardSignal(steps, boardSignals);
}

export function boardItemsForTracks(
  tracks: Track[],
  stepsByTrack: Map<string, TrackStep[]>,
  boardSignals: readonly string[],
): TrackBoardItem[] {
  return tracks.map((track) => ({
    track,
    signal: latestBoardSignal(stepsByTrack.get(track.id) ?? [], boardSignals),
  }));
}

export function collectStatusFacetsFromItems(items: readonly TrackBoardItem[], boardSignals: readonly string[]): TrackStatusFacet[] {
  const counts = new Map<string, number>();

  for (const item of items) {
    const signal = item.signal;
    if (!signal) continue;
    counts.set(signal.tag, (counts.get(signal.tag) ?? 0) + 1);
  }

  return uniqueTrackBoardSignals(boardSignals).map((tag) => ({
    tag,
    count: counts.get(tag) ?? 0,
    suggested: true,
  }));
}

export function filterBoardItemsByStatusTags(items: readonly TrackBoardItem[], selectedTags: readonly string[]): TrackBoardItem[] {
  const selected = new Set(uniqueTrackBoardSignals(selectedTags));
  return items.filter((item) => {
    if (selected.size === 0) return true;
    return item.signal ? selected.has(item.signal.tag) : false;
  });
}
