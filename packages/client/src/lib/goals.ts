import { GoalSchema, TaskSchema, TrackSchema, type Goal, type GoalMemberRef, type GoalPrerequisite, type Task, type Track } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";
import { buildNewRootTask, insertNewTaskInCurrentTransaction } from "./tasks.js";

export interface AddGoalInput {
  title: string;
  kind: Goal["kind"];
  note?: string;
  now?: Date;
}

export interface UpdateGoalPatch {
  title?: string;
  kind?: Goal["kind"];
  status?: Goal["status"];
  note?: string | null;
  members?: GoalMemberRef[];
  prerequisites?: GoalPrerequisite[];
  now?: Date;
}

export interface AddTaskForGoalInput {
  title: string;
  toInbox?: boolean;
  now?: Date;
}

function nowIso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function trimRequired(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function warnInvalidGoal(row: unknown, issues: unknown): void {
  const id = typeof row === "object" && row !== null && "id" in row ? String(row.id) : "?";
  console.warn(`[goals] dropping invalid local goal ${id}:`, issues);
}

function byGoalOrder(a: Goal, b: Goal): number {
  return b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function omitGoalNote(goal: Goal): Goal {
  const { note: _note, ...rest } = goal;
  return rest;
}

function sameGoalMember(left: GoalMemberRef, right: GoalMemberRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

export async function addGoal(input: AddGoalInput): Promise<Goal> {
  const createdAt = nowIso(input.now);
  const candidate = {
    id: uuid(),
    title: trimRequired(input.title, "目标标题不能为空"),
    kind: input.kind,
    status: "active",
    members: [],
    prerequisites: [],
    createdAt,
    updatedAt: createdAt,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  const goal = GoalSchema.parse(candidate);

  await db.transaction("rw", db.goals, db.syncLog, async () => {
    await db.goals.add(goal);
    await recordSyncLog("goals", goal.id, "create", goal.updatedAt);
  });

  return goal;
}

export async function updateGoal(id: string, patch: UpdateGoalPatch): Promise<Goal> {
  const existing = await db.goals.get(id);
  if (!existing) throw new Error("目标不存在");

  let candidate: Goal = {
    ...existing,
    members: existing.members ?? [],
    prerequisites: existing.prerequisites ?? [],
    updatedAt: nowIso(patch.now),
  };
  if (patch.title !== undefined) candidate.title = trimRequired(patch.title, "目标标题不能为空");
  if (patch.kind !== undefined) candidate.kind = patch.kind;
  if (patch.status !== undefined) candidate.status = patch.status;
  if (patch.members !== undefined) candidate.members = patch.members;
  if (patch.prerequisites !== undefined) candidate.prerequisites = patch.prerequisites;
  if (patch.note === null) {
    candidate = omitGoalNote(candidate);
  } else if (patch.note !== undefined) {
    candidate.note = patch.note;
  }

  const next = GoalSchema.parse(candidate);
  await db.transaction("rw", db.goals, db.syncLog, async () => {
    await db.goals.put(next);
    await recordSyncLog("goals", next.id, "update", next.updatedAt);
  });
  return next;
}

export async function updateGoalPrerequisites(
  id: string,
  prerequisites: GoalPrerequisite[],
  options: { now?: Date } = {},
): Promise<Goal> {
  return updateGoal(id, { prerequisites, now: options.now });
}

export async function getGoal(id: string): Promise<Goal | undefined> {
  const row = await db.goals.get(id);
  if (!row) return undefined;
  const parsed = GoalSchema.safeParse(row);
  if (!parsed.success) return undefined;
  return parsed.data;
}

export async function listGoals(status?: Goal["status"]): Promise<Goal[]> {
  const rows = status ? await db.goals.where("status").equals(status).toArray() : await db.goals.toArray();
  const goals: Goal[] = [];
  for (const row of rows) {
    const parsed = GoalSchema.safeParse(row);
    if (!parsed.success) {
      warnInvalidGoal(row, parsed.error.issues);
      continue;
    }
    goals.push(parsed.data);
  }
  return goals.sort(byGoalOrder);
}

export async function addGoalMember(
  goalId: string,
  ref: GoalMemberRef,
  options: { now?: Date } = {},
): Promise<Goal> {
  const timestamp = nowIso(options.now);
  let nextGoal: Goal | null = null;

  await db.transaction("rw", db.goals, db.tasks, db.tracks, db.syncLog, async () => {
    const goal = await db.goals.get(goalId);
    if (!goal) throw new Error("目标不存在");
    if (ref.kind === "task" && !(await db.tasks.get(ref.id))) throw new Error("任务不存在");
    if (ref.kind === "track" && !(await db.tracks.get(ref.id))) throw new Error("轨道不存在");

    const members = goal.members ?? [];
    if (members.some((member) => sameGoalMember(member, ref))) {
      nextGoal = GoalSchema.parse({ ...goal, members, prerequisites: goal.prerequisites ?? [] });
      return;
    }

    const next = GoalSchema.parse({
      ...goal,
      members: [...members, ref],
      prerequisites: goal.prerequisites ?? [],
      updatedAt: timestamp,
    });
    await db.goals.put(next);
    await recordSyncLog("goals", next.id, "update", timestamp);
    nextGoal = next;
  });

  if (!nextGoal) throw new Error("目标不存在");
  return nextGoal;
}

export async function removeGoalMember(
  goalId: string,
  ref: GoalMemberRef,
  options: { now?: Date } = {},
): Promise<Goal> {
  const timestamp = nowIso(options.now);
  let nextGoal: Goal | null = null;

  await db.transaction("rw", db.goals, db.syncLog, async () => {
    const goal = await db.goals.get(goalId);
    if (!goal) throw new Error("目标不存在");

    const members = goal.members ?? [];
    if (!members.some((member) => sameGoalMember(member, ref))) {
      nextGoal = GoalSchema.parse({ ...goal, members, prerequisites: goal.prerequisites ?? [] });
      return;
    }

    const nextMembers = members.filter((member) => !sameGoalMember(member, ref));
    const nextPrerequisites = (goal.prerequisites ?? []).filter(
      (edge) => !sameGoalMember(edge.blocker, ref) && !sameGoalMember(edge.blocked, ref),
    );
    const next = GoalSchema.parse({
      ...goal,
      members: nextMembers,
      prerequisites: nextPrerequisites,
      updatedAt: timestamp,
    });
    await db.goals.put(next);
    await recordSyncLog("goals", next.id, "update", timestamp);
    nextGoal = next;
  });

  if (!nextGoal) throw new Error("目标不存在");
  return nextGoal;
}

export async function addTaskForGoal(goalId: string, input: AddTaskForGoalInput): Promise<Task> {
  const task = await buildNewRootTask({ title: input.title, toInbox: input.toInbox, now: input.now });
  let nextTask: Task | null = null;

  await db.transaction("rw", db.goals, db.tasks, db.syncLog, async () => {
    const goal = await db.goals.get(goalId);
    if (!goal) throw new Error("目标不存在");
    if (goal.status !== "active") throw new Error("归档目标不允许快建任务");

    const nextGoal = GoalSchema.parse({
      ...goal,
      members: [...(goal.members ?? []), { kind: "task", id: task.id }],
      prerequisites: goal.prerequisites ?? [],
      updatedAt: task.updatedAt,
    });

    await insertNewTaskInCurrentTransaction(task);
    await db.goals.put(nextGoal);
    await recordSyncLog("goals", nextGoal.id, "update", nextGoal.updatedAt);
    nextTask = task;
  });

  if (!nextTask) throw new Error("目标不存在");
  return nextTask;
}

export async function listGoalTasks(goalId: string): Promise<Task[]> {
  const goal = await getGoal(goalId);
  if (!goal) return [];
  const taskIds = goal.members.filter((member) => member.kind === "task").map((member) => member.id);
  const rows = await db.tasks.bulkGet(taskIds);
  const byId = new Map<string, Task>();
  for (const row of rows) {
    const parsed = TaskSchema.safeParse(row);
    if (parsed.success) byId.set(parsed.data.id, parsed.data);
  }
  return taskIds.flatMap((id) => {
    const task = byId.get(id);
    return task ? [task] : [];
  });
}

export async function listGoalTracks(goalId: string): Promise<Track[]> {
  const goal = await getGoal(goalId);
  if (!goal) return [];
  const trackIds = goal.members.filter((member) => member.kind === "track").map((member) => member.id);
  const rows = await db.tracks.bulkGet(trackIds);
  const byId = new Map<string, Track>();
  for (const row of rows) {
    const parsed = TrackSchema.safeParse(row);
    if (parsed.success) byId.set(parsed.data.id, parsed.data);
  }
  return trackIds.flatMap((id) => {
    const track = byId.get(id);
    return track ? [track] : [];
  });
}

export async function deleteGoal(id: string, options: { now?: Date } = {}): Promise<void> {
  const timestamp = nowIso(options.now);
  await db.transaction("rw", db.goals, db.syncLog, async () => {
    const goal = await db.goals.get(id);
    if (!goal) throw new Error("目标不存在");

    await db.goals.delete(id);
    await recordSyncLog("goals", id, "delete", timestamp);
  });
}
