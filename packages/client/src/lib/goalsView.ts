import type { Goal, GoalMemberRef, GoalPrerequisite, Task, Track, TrackStep } from "@timedata/shared";

export const THEME_ACTIVITY_WINDOW_DAYS = 7;

export type GoalMemberKind = GoalMemberRef["kind"];

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

export interface GoalMomentum {
  activeMemberCount: number;
  lastActivityAt: string | null;
  windowDays: number;
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
  missingMembers: GoalMemberRef[];
  momentum: GoalMomentum;
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

function goalMemberKey(ref: GoalMemberRef): string {
  return `${ref.kind}:${ref.id}`;
}

function resolveGoalMembers(
  goal: Goal,
  tasks: Task[],
  tracks: Track[],
  steps: TrackStep[],
): { members: GoalMember[]; missingMembers: GoalMemberRef[] } {
  const stepsByTrackId = new Map<string, TrackStep[]>();
  for (const step of steps) {
    const list = stepsByTrackId.get(step.trackId) ?? [];
    list.push(step);
    stepsByTrackId.set(step.trackId, list);
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const members: GoalMember[] = [];
  const missingMembers: GoalMemberRef[] = [];

  for (const ref of goal.members ?? []) {
    if (ref.kind === "task") {
      const task = tasksById.get(ref.id);
      if (!task) {
        missingMembers.push(ref);
        continue;
      }
      members.push({
        kind: "task",
        id: task.id,
        title: task.title,
        completed: task.done,
        activityAt: taskActivityAt(task),
        source: task,
      });
      continue;
    }

    const track = tracksById.get(ref.id);
    if (!track) {
      missingMembers.push(ref);
      continue;
    }
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

  return { members, missingMembers };
}

export function goalMembers(goal: Goal, tasks: Task[], tracks: Track[], steps: TrackStep[]): GoalMember[] {
  return resolveGoalMembers(goal, tasks, tracks, steps).members;
}

export function splitGoalMembers(goal: Goal, members: GoalMember[]): GoalMemberSections {
  const byKey = new Map(members.map((member) => [goalMemberKey(member), member]));
  const ready: GoalMember[] = [];
  const blocked: BlockedGoalMember[] = [];
  const completed: GoalMember[] = [];
  const ignoredPrerequisites: GoalPrerequisite[] = [];
  const validPrerequisites: GoalPrerequisite[] = [];

  for (const edge of goal.prerequisites ?? []) {
    if (!byKey.has(goalMemberKey(edge.blocker)) || !byKey.has(goalMemberKey(edge.blocked))) {
      ignoredPrerequisites.push(edge);
      continue;
    }
    validPrerequisites.push(edge);
  }

  for (const member of members) {
    if (member.completed) {
      completed.push(member);
      continue;
    }

    const waitingOn: GoalMember[] = [];
    for (const edge of validPrerequisites) {
      if (goalMemberKey(edge.blocked) !== goalMemberKey(member)) continue;
      const blocker = byKey.get(goalMemberKey(edge.blocker));
      if (!blocker) continue;
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

export function goalMomentum(members: GoalMember[], now: Date, windowDays: number): GoalMomentum {
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const activeMemberCount = members.filter((member) => member.activityAt >= since && member.activityAt <= nowIso).length;
  const lastActivityAt = members.map((member) => member.activityAt).sort().at(-1) ?? null;
  return { activeMemberCount, lastActivityAt, windowDays };
}

function themeProgress(members: GoalMember[], momentum: GoalMomentum): GoalProgress {
  return {
    kind: "theme",
    activeMemberCount: momentum.activeMemberCount,
    totalMembers: members.length,
    lastActivityAt: momentum.lastActivityAt,
    windowDays: momentum.windowDays,
  };
}

export function buildGoalOverview(
  goal: Goal,
  tasks: Task[],
  tracks: Track[],
  steps: TrackStep[],
  options: { now?: Date; themeWindowDays?: number } = {},
): GoalOverview {
  const { members, missingMembers } = resolveGoalMembers(goal, tasks, tracks, steps);
  const momentum = goalMomentum(
    members,
    options.now ?? new Date(),
    options.themeWindowDays ?? THEME_ACTIVITY_WINDOW_DAYS,
  );
  const progress =
    goal.kind === "project"
      ? projectProgress(members)
      : themeProgress(members, momentum);
  return { goal, members, missingMembers, momentum, progress, sections: splitGoalMembers(goal, members) };
}
