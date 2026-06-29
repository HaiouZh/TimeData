import type { Goal, GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import {
  buildGoalTaskCandidates,
  buildGoalTrackCandidates,
  type GoalTaskCandidate,
  type GoalTaskCandidateOptions,
  type GoalTrackCandidate,
  type GoalTrackCandidateOptions,
} from "../pages/goals/goalMemberCandidates.js";

export interface BuildUnassignedGoalCandidatesOptions
  extends GoalTaskCandidateOptions,
    Pick<GoalTrackCandidateOptions, "boardSignals"> {
  goals: Goal[];
  tasks: Task[];
  tracks: Track[];
  steps: TrackStep[];
}

export interface UnassignedGoalCandidates {
  taskCandidates: GoalTaskCandidate[];
  trackCandidates: GoalTrackCandidate[];
  total: number;
}

function memberKey(ref: GoalMemberRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function activeGoalMemberKeys(goals: readonly Goal[]): Set<string> {
  const keys = new Set<string>();
  for (const goal of goals) {
    if (goal.status !== "active") continue;
    for (const member of goal.members ?? []) keys.add(memberKey(member));
  }
  return keys;
}

/** 被任一 active 目标引用的 task id 集合（用于 inbox「已有去处」外圈提示）。 */
export function goalLinkedTaskIds(goals: readonly Goal[]): Set<string> {
  const ids = new Set<string>();
  for (const goal of goals) {
    if (goal.status !== "active") continue;
    for (const member of goal.members ?? []) {
      if (member.kind === "task") ids.add(member.id);
    }
  }
  return ids;
}

export function activeGoalMemberRefs(goals: readonly Goal[]): GoalMemberRef[] {
  return goals.filter((goal) => goal.status === "active").flatMap((goal) => goal.members);
}

export function unassignedTasks(tasks: readonly Task[], goals: readonly Goal[]): Task[] {
  const owned = activeGoalMemberKeys(goals);
  return tasks.filter((task) => !task.done && !owned.has(`task:${task.id}`));
}

export function unassignedTracks(tracks: readonly Track[], goals: readonly Goal[]): Track[] {
  const owned = activeGoalMemberKeys(goals);
  return tracks.filter((track) => track.status === "active" && !owned.has(`track:${track.id}`));
}

export function buildUnassignedGoalCandidates({
  goals,
  tasks,
  tracks,
  steps,
  boardSignals,
  now,
  searchQuery,
  includeTags,
  excludeTags,
  tagMode,
}: BuildUnassignedGoalCandidatesOptions): UnassignedGoalCandidates {
  const assignedMembers = activeGoalMemberRefs(goals);
  const taskCandidates = buildGoalTaskCandidates(unassignedTasks(tasks, goals), assignedMembers, {
    now,
    searchQuery,
    includeTags,
    excludeTags,
    tagMode,
  });
  const trackCandidates = buildGoalTrackCandidates(unassignedTracks(tracks, goals), steps, assignedMembers, {
    searchQuery,
    boardSignals,
  });

  return {
    taskCandidates,
    trackCandidates,
    total: taskCandidates.length + trackCandidates.length,
  };
}
