import type { Task } from "@timedata/shared";

export interface TodoGravitySettings {
  enabled: boolean;
  waterlineDays: number;
  weightStepDays: number;
  graceDays: number;
  drawM: number;
  pickN: number;
}

export const DEFAULT_TODO_GRAVITY_SETTINGS: TodoGravitySettings = {
  enabled: true,
  waterlineDays: 14,
  weightStepDays: 7,
  graceDays: 7,
  drawM: 5,
  pickN: 1,
};

export type GravitySurfacedMap = Record<string, string>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function ageDaysSince(iso: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);
}

export function isTaskInGracePeriod(task: Task, settings: TodoGravitySettings, now: Date = new Date()): boolean {
  return ageDaysSince(task.createdAt, now) <= settings.graceDays;
}

export function isTaskSunken(task: Task, settings: TodoGravitySettings, now: Date = new Date()): boolean {
  if (!settings.enabled) return false;
  if (task.parentId !== null) return false;
  if (task.scheduledAt !== null || task.done || task.recurrence !== null) return false;
  if (isTaskInGracePeriod(task, settings, now)) return false;

  const effectiveStaleDays = settings.waterlineDays + (task.weight ?? 0) * settings.weightStepDays;
  return ageDaysSince(task.updatedAt, now) > effectiveStaleDays;
}

export function splitInboxByGravity(
  inbox: readonly Task[],
  settings: TodoGravitySettings,
  now: Date = new Date(),
): { floating: Task[]; sunken: Task[] } {
  const floating: Task[] = [];
  const sunken: Task[] = [];
  for (const task of inbox) {
    (isTaskSunken(task, settings, now) ? sunken : floating).push(task);
  }
  return { floating, sunken };
}

export function pickGravityReviewBatch(
  candidates: readonly Task[],
  surfaced: GravitySurfacedMap,
  options: { now?: Date; drawM: number },
): Task[] {
  const now = options.now ?? new Date();
  return [...candidates]
    .sort((a, b) => {
      const aSeen = surfaced[a.id];
      const bSeen = surfaced[b.id];
      if (!aSeen && bSeen) return -1;
      if (aSeen && !bSeen) return 1;
      if (!aSeen && !bSeen) return a.createdAt.localeCompare(b.createdAt);
      const aAge = ageDaysSince(aSeen, now);
      const bAge = ageDaysSince(bSeen, now);
      return bAge - aAge || a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, options.drawM);
}