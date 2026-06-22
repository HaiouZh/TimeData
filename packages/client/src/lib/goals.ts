import { GoalSchema, TaskSchema, TrackSchema, type Goal, type GoalPrerequisite, type Task, type Track } from "@timedata/shared";
import { v4 as uuid } from "uuid";
import { db } from "../db/index.js";
import { recordSyncLog } from "../sync/engine.js";

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
  prerequisites?: GoalPrerequisite[];
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

export async function addGoal(input: AddGoalInput): Promise<Goal> {
  const createdAt = nowIso(input.now);
  const candidate = {
    id: uuid(),
    title: trimRequired(input.title, "目标标题不能为空"),
    kind: input.kind,
    status: "active",
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
    prerequisites: existing.prerequisites ?? [],
    updatedAt: nowIso(patch.now),
  };
  if (patch.title !== undefined) candidate.title = trimRequired(patch.title, "目标标题不能为空");
  if (patch.kind !== undefined) candidate.kind = patch.kind;
  if (patch.status !== undefined) candidate.status = patch.status;
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

export async function assignTaskToGoal(
  taskId: string,
  goalId: string | null,
  options: { now?: Date } = {},
): Promise<Task> {
  if (goalId !== null && !(await db.goals.get(goalId))) throw new Error("目标不存在");
  const existing = await db.tasks.get(taskId);
  if (!existing) throw new Error("任务不存在");

  const updatedAt = nowIso(options.now);
  const next = TaskSchema.parse({
    ...existing,
    parentId: existing.parentId ?? null,
    goalId,
    completedCount: existing.completedCount ?? 0,
    completedAt: existing.completedAt ?? null,
    tags: existing.tags ?? [],
    updatedAt,
  });
  await db.transaction("rw", db.tasks, db.syncLog, async () => {
    await db.tasks.put(next);
    await recordSyncLog("tasks", next.id, "update", updatedAt);
  });
  return next;
}

export async function assignTrackToGoal(
  trackId: string,
  goalId: string | null,
  options: { now?: Date } = {},
): Promise<Track> {
  if (goalId !== null && !(await db.goals.get(goalId))) throw new Error("目标不存在");
  const existing = await db.tracks.get(trackId);
  if (!existing) throw new Error("轨道不存在");

  const updatedAt = nowIso(options.now);
  const next = TrackSchema.parse({
    ...existing,
    refs: existing.refs ?? [],
    goalId,
    updatedAt,
  });
  await db.transaction("rw", db.tracks, db.syncLog, async () => {
    await db.tracks.put(next);
    await recordSyncLog("tracks", next.id, "update", updatedAt);
  });
  return next;
}

export async function listGoalTasks(goalId: string): Promise<Task[]> {
  const rows = await db.tasks.where("goalId").equals(goalId).toArray();
  const tasks: Task[] = [];
  for (const row of rows) {
    const parsed = TaskSchema.safeParse(row);
    if (parsed.success) tasks.push(parsed.data);
  }
  return tasks.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export async function listGoalTracks(goalId: string): Promise<Track[]> {
  const rows = await db.tracks.where("goalId").equals(goalId).toArray();
  const tracks: Track[] = [];
  for (const row of rows) {
    const parsed = TrackSchema.safeParse(row);
    if (parsed.success) tracks.push(parsed.data);
  }
  return tracks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export async function deleteGoal(id: string, options: { now?: Date } = {}): Promise<void> {
  const timestamp = nowIso(options.now);
  await db.transaction("rw", db.goals, db.tasks, db.tracks, db.syncLog, async () => {
    const goal = await db.goals.get(id);
    if (!goal) throw new Error("目标不存在");

    const tasks = await db.tasks.where("goalId").equals(id).toArray();
    const tracks = await db.tracks.where("goalId").equals(id).toArray();

    for (const task of tasks) {
      const next = TaskSchema.parse({
        ...task,
        parentId: task.parentId ?? null,
        goalId: null,
        completedCount: task.completedCount ?? 0,
        completedAt: task.completedAt ?? null,
        tags: task.tags ?? [],
        updatedAt: timestamp,
      });
      await db.tasks.put(next);
      await recordSyncLog("tasks", next.id, "update", timestamp);
    }

    for (const track of tracks) {
      const next = TrackSchema.parse({ ...track, refs: track.refs ?? [], goalId: null, updatedAt: timestamp });
      await db.tracks.put(next);
      await recordSyncLog("tracks", next.id, "update", timestamp);
    }

    await db.goals.delete(id);
    await recordSyncLog("goals", id, "delete", timestamp);
  });
}
