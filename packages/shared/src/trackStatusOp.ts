import type { Track, TrackStatusOp } from "./types.js";

/** status diff -> op。无变化不附 op，避免标题/摘要快照授权改 status 守卫列。 */
export function trackStatusOp(prev: Track | undefined, next: Track, at: string): TrackStatusOp | undefined {
  if (prev?.status === next.status) return undefined;
  return { type: "status", at };
}
