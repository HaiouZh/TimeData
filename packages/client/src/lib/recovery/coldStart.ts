import type { ReloadCause } from "./reloadAttribution.js";

export interface ColdStartInput {
  cause: ReloadCause;
  /** navigation timing 的 domContentLoadedEventEnd，相对导航起点。 */
  domContentLoadedMs: number;
  /** AppShell 首次挂载时刻，相对导航起点；还没挂上时为 null。 */
  firstPaintMs: number | null;
}

export interface ColdStartSegments {
  /** 导航 → DOMContentLoaded：HTML 与 JS 的下载解析。 */
  parseMs: number;
  /** → React 首帧：挂载与首屏渲染。首帧未到时为 null——不拿 0 冒充，否则统计会被拉低。 */
  mountMs: number | null;
}

export function computeColdStartSegments(input: ColdStartInput): ColdStartSegments {
  const parseMs = Math.round(input.domContentLoadedMs);
  if (input.firstPaintMs === null) return { parseMs, mountMs: null };
  // 时序倒挂（时钟精度或 timing 缺失）时夹到 0：负数会污染后续的分位数统计。
  return { parseMs, mountMs: Math.max(0, Math.round(input.firstPaintMs - input.domContentLoadedMs)) };
}

/** 拼成 sync_logs 的一行。字段只有耗时数字与归因标签，不含任何内容数据。 */
export function buildColdStartReport(input: ColdStartInput): {
  action: string;
  detail: string;
  record_count: number;
} {
  const segments = computeColdStartSegments(input);
  return {
    action: "cold_start",
    detail: JSON.stringify({ cause: input.cause, ...segments }),
    record_count: 0,
  };
}
