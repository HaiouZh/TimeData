import type { Ref, Track, TrackStep } from "@timedata/shared";
import { formatMinutesDuration } from "./time.js";

const MS_PER_DAY = 86_400_000;
// 决策步词表:命中即视觉区分。tag 是开放扩展,这里只挑出"用于视觉分流"的一组,不进 schema。
const DECISION_TAGS = new Set(["决策", "decision"]);

function byTrackStepOrderAsc(a: TrackStep, b: TrackStep): number {
  return a.seq - b.seq || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id);
}

export function groupStepsByTrack(steps: TrackStep[]): Map<string, TrackStep[]> {
  const grouped = new Map<string, TrackStep[]>();
  for (const step of steps) {
    const list = grouped.get(step.trackId);
    if (list) list.push(step);
    else grouped.set(step.trackId, [step]);
  }
  for (const list of grouped.values()) list.sort(byTrackStepOrderAsc);
  return grouped;
}

export function currentStepId(steps: TrackStep[]): string | null {
  let current: TrackStep | null = null;
  for (const step of steps) {
    if (step.endedAt !== null) continue;
    if (current === null || step.seq > current.seq) current = step;
  }
  return current?.id ?? null;
}

export function orderedTimeline(steps: TrackStep[]): TrackStep[] {
  return [...steps].sort((a, b) => -byTrackStepOrderAsc(a, b));
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

export function trackProgressSummary(steps: TrackStep[], now: Date): string {
  if (steps.length === 0) return "尚无步骤";
  const openId = currentStepId(steps);
  if (openId === null) return `共${steps.length}步 · 已收束`;
  const open = steps.find((s) => s.id === openId);
  const elapsed = open ? formatStepDuration(open.startedAt, null, now) : "";
  return `当前:第${steps.length}步 · 已历时${elapsed}`;
}

export function isDecisionStep(step: TrackStep): boolean {
  return step.tags.some((tag) => DECISION_TAGS.has(tag));
}

// 外链判定:仅 id 为 http(s) 才算可点外链。kind 不参与放行——url 型 ref 的 id 同样须带 http(s) 协议。
// 用协议白名单而非信任 kind,避免 javascript:/data: 等危险协议被塞进 RefChip 的 href 触发自 XSS
// (与 quick-notes 经 rehype-sanitize 处理用户 URL 的安全姿态一致)。
export function isLinkRef(ref: Ref): boolean {
  return /^https?:\/\//i.test(ref.id);
}
