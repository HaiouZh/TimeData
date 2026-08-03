// 轨道信号徽章 tone 的唯一来源：调度台列表项与 todo 行徽章共用。
// 判定顺序与 tracksDispatch.classify 对齐：actionTags[0]（待我处理约定位）先于 agentExecTags。
export type TrackBadgeTone = "warn" | "agent" | "default";

export const BADGE_TONE_CLASSES: Record<TrackBadgeTone, string> = {
  warn: "border-warn/40 bg-warn/10 text-warn",
  agent: "border-track-agent/40 bg-track-agent/10 text-track-agent",
  default: "border-accent/30 bg-accent-soft text-accent",
};

export function badgeToneForSignal(
  signal: { tag: string } | null,
  actionTags: readonly string[],
  agentExecTags: readonly string[],
): TrackBadgeTone {
  if (signal === null) return "default";
  if (actionTags[0] !== undefined && signal.tag === actionTags[0]) return "warn";
  if (agentExecTags.includes(signal.tag)) return "agent";
  return "default";
}
