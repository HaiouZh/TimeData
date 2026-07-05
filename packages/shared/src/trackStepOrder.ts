import type { TrackStep } from "./types.js";

/** 轨道步语义时间排序：(startedAt, seq, id) 升序。seq 只做同刻写入的稳定裁决。 */
export function compareTrackStepsBySemanticTime(a: TrackStep, b: TrackStep): number {
  return a.startedAt.localeCompare(b.startedAt) || a.seq - b.seq || a.id.localeCompare(b.id);
}

export function compareTrackStepsBySemanticTimeDesc(a: TrackStep, b: TrackStep): number {
  return -compareTrackStepsBySemanticTime(a, b);
}

/** 全部步中语义时间最大者。 */
export function latestTrackStep(steps: readonly TrackStep[]): TrackStep | null {
  let latest: TrackStep | null = null;
  for (const step of steps) {
    if (latest === null || compareTrackStepsBySemanticTime(step, latest) > 0) latest = step;
  }
  return latest;
}

/** 开口步（endedAt=null）中语义时间最大者，是“当前步”的唯一裁决口径。 */
export function latestOpenStep(steps: readonly TrackStep[]): TrackStep | null {
  return latestTrackStep(steps.filter((step) => step.endedAt === null));
}

/** 全部开口步，语义时间升序。写入路径幂等闭合全部开口用。 */
export function listOpenSteps(steps: readonly TrackStep[]): TrackStep[] {
  return steps.filter((step) => step.endedAt === null).sort(compareTrackStepsBySemanticTime);
}
