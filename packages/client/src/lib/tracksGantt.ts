// tracks 并发甘特的纯函数层：窗口模型/比例尺/刻度/泳道布局。
// 约束：窗口右缘 ≤ 此刻（track 无未来）；跨度 clamp [1h, 7d]；全部纯函数，node 快桶可测。
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const GANTT_MIN_SPAN_MS = HOUR_MS;
export const GANTT_MAX_SPAN_MS = 7 * DAY_MS;
export const AFTERGLOW_MS = 2 * HOUR_MS;
export const POINT_MIN_PX = 6;

export interface GanttWindow {
  startMs: number;
  endMs: number;
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

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
