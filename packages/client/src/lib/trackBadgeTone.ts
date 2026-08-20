// 轨道信号徽章的 **CSS 映射表**唯一来源：调度台列表项（TrackListItem）与 todo 行徽章（TaskTrackChip）
// 共用 BADGE_TONE_CLASSES，改配色只改这一处。
//
// **判定逻辑不在此收口**：调度台的 tone 走 tracksDispatch.classify() 产出的 DispatchGroupKey，
// 再经 TracksBoard 的 GROUP_BADGE_TONES 静态表转换，从不调用本文件的 badgeToneForSignal。
// 两份实现靠约定对齐——「actionTags[0]（待我处理约定位）先于 agentExecTags」这条顺序改一边要记得改另一边。
// 另：本 tone 只有三档，不含 wait-external 组（调度台把它也映射成 default）。
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
  // actionTags 为空时 actionTags[0] 是 undefined，而 signal.tag 恒为字符串，比较自然为 false——不必另判。
  if (signal.tag === actionTags[0]) return "warn";
  if (agentExecTags.includes(signal.tag)) return "agent";
  return "default";
}
