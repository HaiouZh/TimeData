// tracks 并发甘特的纯函数层：窗口模型/比例尺/刻度/泳道布局。
// 约束：窗口右缘 ≤ 此刻（track 无未来）；跨度 clamp [1h, 7d]；全部纯函数，node 快桶可测。
import type { Track, TrackStep } from "@timedata/shared";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const GANTT_MIN_SPAN_MS = HOUR_MS;
export const GANTT_MAX_SPAN_MS = 7 * DAY_MS;
export const AFTERGLOW_MS = 2 * HOUR_MS;
export const POINT_MIN_PX = 6;
export const RUNNING_MIN_PX = 12;

export interface GanttWindow {
  startMs: number;
  endMs: number;
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 窗口右缘严格 ≤ 此刻：数据上没有未来；"现在"的焦点交给画布右侧的现状栏，
// 不再用时间留白制造呼吸空间（时间比例的留白会随缩放膨胀成大块假未来）。
export function clampWindow(w: GanttWindow, nowMs: number, minStartMs: number): GanttWindow {
  const span = Math.min(GANTT_MAX_SPAN_MS, Math.max(GANTT_MIN_SPAN_MS, w.endMs - w.startMs));
  let end = Math.min(w.endMs, nowMs);
  let start = end - span;
  if (start < minStartMs) {
    start = minStartMs;
    end = Math.min(nowMs, start + span);
  }
  return { startMs: start, endMs: end };
}

export function zoomWindow(
  w: GanttWindow,
  anchorRatio: number,
  factor: number,
  nowMs: number,
  minStartMs: number,
): GanttWindow {
  const span = w.endMs - w.startMs;
  const newSpan = Math.min(GANTT_MAX_SPAN_MS, Math.max(GANTT_MIN_SPAN_MS, span * factor));
  const anchorT = w.startMs + anchorRatio * span;
  const start = anchorT - anchorRatio * newSpan;
  return clampWindow({ startMs: start, endMs: start + newSpan }, nowMs, minStartMs);
}

export function panWindow(w: GanttWindow, deltaMs: number, nowMs: number, minStartMs: number): GanttWindow {
  return clampWindow({ startMs: w.startMs + deltaMs, endMs: w.endMs + deltaMs }, nowMs, minStartMs);
}

export function presetWindow(preset: "today" | "3d" | "7d", nowMs: number): GanttWindow {
  if (preset === "3d") return { startMs: nowMs - 3 * DAY_MS, endMs: nowMs };
  if (preset === "7d") return { startMs: nowMs - 7 * DAY_MS, endMs: nowMs };
  const start = Math.min(startOfLocalDay(nowMs), nowMs - GANTT_MIN_SPAN_MS);
  return { startMs: start, endMs: nowMs };
}

export function timeToX(w: GanttWindow, width: number, tMs: number): number {
  return ((tMs - w.startMs) / (w.endMs - w.startMs)) * width;
}

export function xToMs(w: GanttWindow, width: number, x: number): number {
  return w.startMs + (x / width) * (w.endMs - w.startMs);
}

export interface AxisTick {
  tMs: number;
  label: string;
}

export interface GanttSegment {
  kind: "bar" | "point" | "running";
  startMs: number;
  endMs: number;
  stepId: string;
  source: "user" | "agent";
  // 仅 running 段：开步超过 AFTERGLOW_MS 没动静时为"实头截止时刻"（start+2h），
  // 渲染成实头+虚线尾迹（"口没闭但很久没动静"）；新鲜开口步为 null，实条画到此刻。
  staleSinceMs?: number | null;
  // 等待段：步子带"等待信号"（约定=第一个配置的看板信号,如 待我处理）。语义是"等人接手"
  // 而非干活，渲染为空心条——它的长度就是接力空档，无需人工闭合步骤。
  waiting?: boolean;
}

export interface GanttLane {
  track: Track;
  segments: GanttSegment[];
  afterglow: { startMs: number; endMs: number } | null;
  lastActivityMs: number | null;
}

const parseMs = (isoText: string): number => new Date(isoText).getTime();

// 段的"执行者"：信号优先、回退写入者——步子带任一"agent 执行信号"标签（可在 /settings/tracks 配置，
// 默认 agent在做）视为 agent 在干，覆盖手记"交给 agent"场景；否则按 step.source（谁写入这一步）。
export function stepExecutor(
  step: Pick<TrackStep, "source" | "tags">,
  agentExecTags: readonly string[],
): "user" | "agent" {
  return step.tags.some((tag) => agentExecTags.includes(tag)) ? "agent" : step.source;
}

function laneSegments(
  steps: TrackStep[],
  nowMs: number,
  agentExecTags: readonly string[],
  waitingTags: readonly string[],
): GanttSegment[] {
  const segments = steps.map((step): GanttSegment => {
    const startMs = parseMs(step.startedAt);
    const source = stepExecutor(step, agentExecTags);
    const waiting = step.tags.some((tag) => waitingTags.includes(tag));
    if (step.endedAt === null) {
      // 时钟漂移防御：未来开口步退化为点，不画负长条
      if (startMs >= nowMs) return { kind: "point", startMs, endMs: startMs, stepId: step.id, source, waiting };
      const staleSinceMs = nowMs - startMs > AFTERGLOW_MS ? startMs + AFTERGLOW_MS : null;
      return { kind: "running", startMs, endMs: nowMs, stepId: step.id, source, staleSinceMs, waiting };
    }
    const endMs = parseMs(step.endedAt);
    if (endMs <= startMs) return { kind: "point", startMs, endMs: startMs, stepId: step.id, source, waiting };
    return { kind: "bar", startMs, endMs, stepId: step.id, source, waiting };
  });
  return segments.sort((a, b) => a.startMs - b.startMs);
}

function laneAfterglow(segments: GanttSegment[], nowMs: number): { startMs: number; endMs: number } | null {
  if (segments.length === 0 || segments.some((s) => s.kind === "running")) return null;
  const lastEnd = Math.max(...segments.map((s) => s.endMs));
  if (lastEnd >= nowMs || nowMs - lastEnd >= AFTERGLOW_MS) return null;
  return { startMs: lastEnd, endMs: Math.min(lastEnd + AFTERGLOW_MS, nowMs) };
}

export function ganttLanes(
  tracks: Track[],
  stepsByTrack: Map<string, TrackStep[]>,
  nowMs: number,
  agentExecTags: readonly string[] = [],
  waitingTags: readonly string[] = [],
): GanttLane[] {
  const lanes = tracks.map((track): GanttLane => {
    const steps = stepsByTrack.get(track.id) ?? [];
    const segments = laneSegments(steps, nowMs, agentExecTags, waitingTags);
    // 与 tracksView.lastActivityAt 同语义：闭合步取结束、开口步取开始
    const lastActivityMs =
      steps.length === 0 ? null : Math.max(...steps.map((s) => parseMs(s.endedAt ?? s.startedAt)));
    return { track, segments, afterglow: laneAfterglow(segments, nowMs), lastActivityMs };
  });
  return lanes.sort((a, b) => {
    if (a.lastActivityMs !== null && b.lastActivityMs !== null) return b.lastActivityMs - a.lastActivityMs;
    if (a.lastActivityMs !== null) return -1;
    if (b.lastActivityMs !== null) return 1;
    return parseMs(b.track.createdAt) - parseMs(a.track.createdAt);
  });
}

export function visibleSegments(segments: GanttSegment[], w: GanttWindow): GanttSegment[] {
  return segments.filter((s) => s.endMs >= w.startMs && s.startMs <= w.endMs);
}

const AUTO_FIT_MIN_LOOKBACK_MS = 6 * HOUR_MS;
// auto-fit 只迁就最近 48h 内有动静的泳道；全员不活跃时退最近 24h——
// 僵尸开口步（挂了几天没闭合）不再把默认视野拉爆到一周。
const AUTO_FIT_RECENT_MS = 48 * HOUR_MS;
const AUTO_FIT_FALLBACK_LOOKBACK_MS = 24 * HOUR_MS;

// auto-fit：右缘=此刻+留白，左缘回溯到能露出"最近活跃泳道"最新一步的开始（下限 6h、上限 7d），epoch 整点取整。
export function autoFitWindow(lanes: GanttLane[], nowMs: number): GanttWindow {
  const latestStarts = lanes
    .filter(
      (l) => l.segments.length > 0 && l.lastActivityMs !== null && nowMs - l.lastActivityMs <= AUTO_FIT_RECENT_MS,
    )
    .map((l) => l.segments[l.segments.length - 1].startMs);
  if (latestStarts.length === 0) return { startMs: nowMs - AUTO_FIT_FALLBACK_LOOKBACK_MS, endMs: nowMs };
  const rawLeft = Math.min(...latestStarts);
  const clamped = Math.max(nowMs - GANTT_MAX_SPAN_MS, Math.min(rawLeft, nowMs - AUTO_FIT_MIN_LOOKBACK_MS));
  return { startMs: Math.floor(clamped / HOUR_MS) * HOUR_MS, endMs: nowMs };
}

// 泳道"此刻状态"：现状栏用。running=新鲜开口步 / stale-open=开着但超2h没动静 /
// recent=刚收尾(余晖人群) / idle=停着(sinceMs=最后动静,无步为 null)。
export type LaneNowStatus =
  | { kind: "running"; sinceMs: number }
  | { kind: "waiting"; sinceMs: number }
  | { kind: "stale-open"; sinceMs: number }
  | { kind: "recent"; sinceMs: number }
  | { kind: "idle"; sinceMs: number | null };

export function laneNowStatus(lane: GanttLane, _nowMs: number): LaneNowStatus {
  const running = lane.segments.filter((s) => s.kind === "running");
  if (running.length > 0) {
    const latest = running[running.length - 1];
    // 等待中的开口步优先于新鲜/陈旧之分：它在等人接手，不是在干活也不算失联。
    if (latest.waiting) return { kind: "waiting", sinceMs: latest.startMs };
    return latest.staleSinceMs == null
      ? { kind: "running", sinceMs: latest.startMs }
      : { kind: "stale-open", sinceMs: latest.startMs };
  }
  if (lane.afterglow) return { kind: "recent", sinceMs: lane.afterglow.startMs };
  return { kind: "idle", sinceMs: lane.lastActivityMs };
}

// 平移/缩放的左边界：最早一步所在天的本地零点；无步退到今天零点。
export function earliestSegmentDayMs(lanes: GanttLane[], nowMs: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (const lane of lanes) for (const seg of lane.segments) min = Math.min(min, seg.startMs);
  return startOfLocalDay(Number.isFinite(min) ? min : nowMs);
}

export function concurrencyStats(lanes: GanttLane[], nowMs: number): { running: number; active24h: number } {
  let running = 0;
  let active24h = 0;
  for (const lane of lanes) {
    if (lane.segments.some((s) => s.kind === "running")) running += 1;
    // 活跃只看最后动静时间：陈旧开口步（挂了很多天没闭合）不算 24h 活跃。
    if (lane.lastActivityMs !== null && nowMs - lane.lastActivityMs <= DAY_MS) active24h += 1;
  }
  return { running, active24h };
}

export type SegmentShape = { shape: "rect"; x: number; width: number } | { shape: "dot"; cx: number };

export function segmentShape(seg: GanttSegment, w: GanttWindow, width: number): SegmentShape {
  const x1 = timeToX(w, width, seg.startMs);
  const x2 = timeToX(w, width, seg.endMs);
  if (seg.kind === "point") return { shape: "dot", cx: (x1 + x2) / 2 };
  if (seg.kind === "running") {
    // 开口步保底宽度：右缘锚定在 endMs（此刻/实头截止），向左补足，左缘不越 0——
    // 新开的步不再被线性比例尺压成小点。
    const barWidth = Math.min(width, Math.max(x2 - x1, RUNNING_MIN_PX));
    return { shape: "rect", x: Math.max(0, x2 - barWidth), width: barWidth };
  }
  if (x2 - x1 < POINT_MIN_PX) return { shape: "dot", cx: (x1 + x2) / 2 };
  return { shape: "rect", x: x1, width: x2 - x1 };
}

// 刻度：目标一屏 ≤8 个；对齐本地零点起步，跨度大时退到天级。中国无夏令时，固定步长安全。
export function axisTicks(w: GanttWindow): AxisTick[] {
  const span = w.endMs - w.startMs;
  const step = [HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS, DAY_MS].find((s) => span / s <= 8) ?? DAY_MS;
  const base = startOfLocalDay(w.startMs);
  const ticks: AxisTick[] = [];
  for (let t = base; t <= w.endMs; t += step) {
    if (t < w.startMs) continue;
    const d = new Date(t);
    const label =
      d.getHours() === 0 && d.getMinutes() === 0
        ? `${d.getMonth() + 1}/${d.getDate()}`
        : `${String(d.getHours()).padStart(2, "0")}:00`;
    ticks.push({ tMs: t, label });
  }
  return ticks;
}
