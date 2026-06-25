import type { Goal, Task, Track, TrackStep } from "@timedata/shared";
import { buildGoalOverview, THEME_ACTIVITY_WINDOW_DAYS } from "./goalsView.js";

export interface GalaxyRollup {
  completed: number;
  total: number;
  ratio: number;
  weekActiveMembers: number;
  activeGoals: number;
}

export function goalGalaxyRollup(
  goals: Goal[],
  tasks: Task[],
  tracks: Track[],
  steps: TrackStep[],
  options: { now?: Date } = {},
): GalaxyRollup {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - THEME_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();
  let completed = 0;
  let total = 0;
  let activeGoals = 0;
  const weekActiveMembers = new Set<string>();

  for (const goal of goals) {
    if (goal.status !== "active") continue;
    const overview = buildGoalOverview(goal, tasks, tracks, steps, { now });

    if (overview.progress.kind === "project") {
      completed += overview.progress.completed;
      total += overview.progress.total;
    }
    if (overview.momentum.activeMemberCount > 0) {
      activeGoals += 1;
    }
    for (const member of overview.members) {
      if (member.activityAt >= since && member.activityAt <= nowIso) {
        weekActiveMembers.add(`${member.kind}:${member.id}`);
      }
    }
  }

  return {
    completed,
    total,
    ratio: total === 0 ? 0 : completed / total,
    weekActiveMembers: weekActiveMembers.size,
    activeGoals,
  };
}
