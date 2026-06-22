import type { Goal, GoalPrerequisite, Task, Track, TrackStep } from "@timedata/shared";

export const THEME_ACTIVITY_WINDOW_DAYS = 7;

export type GoalMemberKind = "task" | "track";

export interface GoalMember {
  kind: GoalMemberKind;
  id: string;
  title: string;
  completed: boolean;
  activityAt: string;
  source: Task | Track;
  steps?: TrackStep[];
}

export type GoalProgress =
  | { kind: "project"; completed: number; total: number; ratio: number }
  | {
    kind: "theme";
    activeMemberCount: number;
    totalMembers: number;
    lastActivityAt: string | null;
    windowDays: number;
  };

export interface BlockedGoalMember extends GoalMember {
  waitingOn: GoalMember[];
}

export interface GoalMemberSections {
  ready: GoalMember[];
  blocked: BlockedGoalMember[];
  completed: GoalMember[];
  ignoredPrerequisites: GoalPrerequisite[];
}

export interface GoalOverview {
  goal: Goal;
  members: GoalMember[];
  progress: GoalProgress;
  sections: GoalMemberSections;
}

function taskActivityAt(task: Task): string {
  return task.completedAt ?? task.updatedAt;
}

function trackActivityAt(track: Track, steps: TrackStep[]): string {
  const stepTimes = steps.map((step) => step.endedAt ?? step.startedAt ?? step.updatedAt);
  return [track.updatedAt, ...stepTimes].sort().at(-1) ?? track.updatedAt;
}

export function goalMemberActivityAt(member: GoalMember): string {
  return member.activityAt;
}

export function goalMembers(goal: Goal, tasks: Task[], tracks: Track[], steps: TrackStep[]): GoalMember[] {
  const stepsByTrackId = new Map<string, TrackStep[]>();
  for (const step of steps) {
    const list = stepsByTrackId.get(step.trackId) ?? [];
    list.push(step);
    stepsByTrackId.set(step.trackId, list);
  }

  const members: GoalMember[] = [];
  for (const task of tasks) {
    if ((task.goalId ?? null) !== goal.id) continue;
    members.push({
      kind: "task",
      id: task.id,
      title: task.title,
      completed: task.done,
      activityAt: taskActivityAt(task),
      source: task,
    });
  }
  for (const track of tracks) {
    if ((track.goalId ?? null) !== goal.id) continue;
    const trackSteps = stepsByTrackId.get(track.id) ?? [];
    members.push({
      kind: "track",
      id: track.id,
      title: track.title,
      completed: track.status === "concluded",
      activityAt: trackActivityAt(track, trackSteps),
      source: track,
      steps: trackSteps,
    });
  }

  return members;
}

export function splitGoalMembers(goal: Goal, members: GoalMember[]): GoalMemberSections {
  const byId = new Map(members.map((member) => [member.id, member]));
  const ready: GoalMember[] = [];
  const blocked: BlockedGoalMember[] = [];
  const completed: GoalMember[] = [];
  const ignoredPrerequisites: GoalPrerequisite[] = [];

  for (const member of members) {
    if (member.completed) {
      completed.push(member);
      continue;
    }

    const waitingOn: GoalMember[] = [];
    for (const edge of goal.prerequisites ?? []) {
      if (edge.blocked !== member.id) continue;
      const blocker = byId.get(edge.blocker);
      if (!blocker) {
        ignoredPrerequisites.push(edge);
        continue;
      }
      if (!blocker.completed) waitingOn.push(blocker);
    }

    if (waitingOn.length > 0) blocked.push({ ...member, waitingOn });
    else ready.push(member);
  }

  return { ready, blocked, completed, ignoredPrerequisites };
}

function projectProgress(members: GoalMember[]): GoalProgress {
  const total = members.length;
  const completed = members.filter((member) => member.completed).length;
  return { kind: "project", completed, total, ratio: total === 0 ? 0 : completed / total };
}

function themeProgress(members: GoalMember[], now: Date, windowDays: number): GoalProgress {
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const active = members.filter((member) => member.activityAt >= since && member.activityAt <= nowIso);
  const lastActivityAt = members.map((member) => member.activityAt).sort().at(-1) ?? null;
  return { kind: "theme", activeMemberCount: active.length, totalMembers: members.length, lastActivityAt, windowDays };
}

export function buildGoalOverview(
  goal: Goal,
  tasks: Task[],
  tracks: Track[],
  steps: TrackStep[],
  options: { now?: Date; themeWindowDays?: number } = {},
): GoalOverview {
  const members = goalMembers(goal, tasks, tracks, steps);
  const progress =
    goal.kind === "project"
      ? projectProgress(members)
      : themeProgress(members, options.now ?? new Date(), options.themeWindowDays ?? THEME_ACTIVITY_WINDOW_DAYS);
  return { goal, members, progress, sections: splitGoalMembers(goal, members) };
}
