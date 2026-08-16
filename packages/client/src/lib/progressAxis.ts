import type { Goal, Task, Track, TrackStep } from "@timedata/shared";
import { placementForTask } from "./tasks/placement.js";
import { isTaskSunken, type TodoGravitySettings } from "./tasks/gravity.js";
import { STALL_THRESHOLD_MS } from "./tracksDispatch.js";
import { lastActivityAt, latestStep } from "./tracksView.js";
import { findActiveTrackForTask } from "./taskTrackIndex.js";

/** 推进桶。顺序即显示序。 */
export type ProgressBucket = "doing" | "waiting" | "queued" | "todo" | "settled";

export const PROGRESS_BUCKET_ORDER: readonly ProgressBucket[] = [
  "doing",
  "waiting",
  "queued",
  "todo",
  "settled",
];

export const PROGRESS_BUCKET_LABELS: Record<ProgressBucket, string> = {
  doing: "在做",
  waiting: "在等",
  queued: "在排",
  todo: "待办",
  settled: "已了结",
};

export interface TaskBucketContext {
  /** 当前活跃场 id；null 表示无活跃场。 */
  handSessionId: string | null;
  /** 归属于某 active project 的任务 id 集合。 */
  projectMemberIds: ReadonlySet<string>;
  gravitySettings: TodoGravitySettings;
  now: Date;
  /** 「${kind}:${id} → 未完成的 blocker 的 ${kind}:${id} 列表」。由调用方用
   *  buildBlockedByIndex 算好塞进来；缺省或空表示没有被挡。 */
  blockedBy?: Map<string, string[]>;
}

/**
 * 任务落哪个推进桶；返回 null 表示不进面板（子任务 / 重复模板本体 / 已消解的发）。
 * 判定一律基于 placementForTask 的结果，不自行比较日期——时区口径只有一份。
 */
export function bucketForTask(task: Task, ctx: TaskBucketContext): ProgressBucket | null {
  if (task.recurrence !== null) return null;
  if (task.ruleId !== null && task.skipped) return null;

  const placement = placementForTask(task, ctx.now);
  if (placement.pool === "completed") return "settled";
  if (ctx.handSessionId !== null && task.sessionId === ctx.handSessionId) return "doing";
  if (placement.pool === "today") return "doing";
  // 结构式 waiting（阶段3）：被未完成前置挡住 → 在等。放在时间式之前——
  // 「说得出等什么」比「沉太久」更具体，两者同时成立时前者的信息量更大。
  const blockers = ctx.blockedBy?.get(`task:${task.id}`) ?? [];
  if (blockers.length > 0) return "waiting";
  // 4a：排期已过被 placement 退回收件箱。无排期任务同样落 inbox，靠 scheduledAt 区分。
  if (placement.pool === "inbox" && task.scheduledAt !== null) return "waiting";
  // 4b：isTaskSunken 自身排除 scheduledAt 非空者，故与 4a 结构互斥。
  if (isTaskSunken(task, ctx.gravitySettings, ctx.now)) return "waiting";
  if (placement.pool === "upcoming") return "queued";
  if (ctx.projectMemberIds.has(task.id)) return "queued";
  return "todo";
}

/**
 * 轨道落哪个推进桶。停滞判定复用 dispatchItems 的口径（阈值 + 无步用 createdAt 兜底），
 * 且刻意排在开口步之前——挂着开口步但十几天没动，真相是卡住而不是在做。
 */
export function bucketForTrack(track: Track, steps: readonly TrackStep[], now: Date): ProgressBucket {
  if (track.status !== "active") return "settled";

  const activityAt = lastActivityAt([...steps]);
  const idleMs = now.getTime() - new Date(activityAt ?? track.createdAt).getTime();
  if (idleMs > STALL_THRESHOLD_MS) return "waiting";

  if (steps.some((step) => step.endedAt === null)) return "doing";
  if (steps.length === 0) return "queued";
  return "doing";
}

/**
 * 项目组按成员桶 roll-up。waiting 是**结构式**判定（照 GTD Tracks 的 stalled?：
 * 队列里还有没有能动的），与 Track 的时间式 waiting 是两套机制。
 *
 * Task 两种都有：阶段3 起被前置挡住是结构式（bucketForTask 序 4），沉太久仍是
 * 时间式。此处的项目级判定不看边、只 roll-up 成员桶——成员是被前置挡的还是沉太久的，
 * 对「这个项目还推得动吗」是同一个答案。
 *
 * 入参只有桶、看不见成员种类，这是刻意的：GoalMemberRef.kind 有 task 与 track 两种，
 * 调用方各自判好桶再喂进来，本函数不需要为第二种成员改一个字。
 */
export function bucketForProject(memberBuckets: readonly ProgressBucket[]): ProgressBucket | null {
  if (memberBuckets.length === 0) return null;
  if (memberBuckets.some((bucket) => bucket === "doing")) return "doing";

  const unsettled = memberBuckets.filter((bucket) => bucket !== "settled");
  if (unsettled.length === 0) return "settled";
  if (unsettled.every((bucket) => bucket === "waiting")) return "waiting";
  return "queued";
}

export type ProgressMeter =
  | { kind: "subtasks"; done: number; total: number }
  | { kind: "steps"; count: number }
  | { kind: "members"; done: number; total: number };

export interface ProgressItem {
  key: string;
  kind: "task" | "track" | "project";
  bucket: ProgressBucket;
  title: string;
  taskId: string | null;
  trackId: string | null;
  goalId: string | null;
  progress: ProgressMeter | null;
  lastActivityAt: string | null;
  latestNote: string | null;
}

export interface ProgressAxisInput {
  tasks: readonly Task[];
  /** parentId → 子任务；用于算子任务进度。 */
  childrenByParent: ReadonlyMap<string, Task[]>;
  tracks: readonly Track[];
  stepsByTrack: ReadonlyMap<string, TrackStep[]>;
  /** 只传 status==="active" && kind==="project" 的裸行。 */
  projects: readonly Goal[];
  handSessionId: string | null;
  gravitySettings: TodoGravitySettings;
  now: Date;
}

function subtaskMeter(children: readonly Task[] | undefined): ProgressMeter | null {
  if (!children || children.length === 0) return null;
  const counted = children.filter((child) => !child.skipped);
  if (counted.length === 0) return null;
  return { kind: "subtasks", done: counted.filter((child) => child.done).length, total: counted.length };
}

export function buildProgressItems(input: ProgressAxisInput): ProgressItem[] {
  const { tasks, childrenByParent, tracks, stepsByTrack, projects, handSessionId, gravitySettings, now } = input;

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const projectMemberIds = new Set<string>();
  for (const goal of projects) {
    for (const member of goal.members) {
      if (member.kind === "task") projectMemberIds.add(member.id);
    }
  }

  const ctx: TaskBucketContext = { handSessionId, projectMemberIds, gravitySettings, now };
  const items: ProgressItem[] = [];
  const consumedTrackIds = new Set<string>();
  const bucketByTaskId = new Map<string, ProgressBucket>();
  /** 轨道的**最终**桶：被合并进任务行的取任务的桶（§4 桶冲突），独立成行的取自己的。 */
  const bucketByTrackId = new Map<string, ProgressBucket>();

  for (const task of tasks) {
    const bucket = bucketForTask(task, ctx);
    if (bucket === null) continue;
    bucketByTaskId.set(task.id, bucket);

    const track = findActiveTrackForTask(tracks, task.id);
    // 只有「本轨道 refs 里下标最小的、且查得到的 task」才吃掉轨道；其余任务独立成行。
    const owned =
      track !== null &&
      track.refs.filter((ref) => ref.kind === "task" && taskById.has(ref.id))[0]?.id === task.id
        ? track
        : null;
    if (owned !== null) {
      consumedTrackIds.add(owned.id);
      bucketByTrackId.set(owned.id, bucket);
    }

    const steps = owned === null ? [] : (stepsByTrack.get(owned.id) ?? []);
    items.push({
      key: `task:${task.id}`,
      kind: "task",
      bucket,
      title: task.title,
      taskId: task.id,
      trackId: owned?.id ?? null,
      goalId: null,
      progress:
        steps.length > 0
          ? { kind: "steps", count: steps.length }
          : subtaskMeter(childrenByParent.get(task.id)),
      lastActivityAt: task.updatedAt,
      latestNote: latestStep([...steps])?.content ?? null,
    });
  }

  for (const track of tracks) {
    if (consumedTrackIds.has(track.id)) continue;
    const steps = stepsByTrack.get(track.id) ?? [];
    const bucket = bucketForTrack(track, steps, now);
    bucketByTrackId.set(track.id, bucket);
    items.push({
      key: `track:${track.id}`,
      kind: "track",
      bucket,
      title: track.title,
      taskId: null,
      trackId: track.id,
      goalId: null,
      progress: steps.length > 0 ? { kind: "steps", count: steps.length } : null,
      lastActivityAt: lastActivityAt([...steps]) ?? track.createdAt,
      latestNote: latestStep([...steps])?.content ?? null,
    });
  }

  // projects 放在最后：它读 bucketByTrackId，而那张表要等上面两个循环都填完才完整。
  for (const goal of projects) {
    const memberBuckets: ProgressBucket[] = [];
    let latest: string | null = null;
    for (const member of goal.members) {
      // 两种成员都算——只收 task 会让「成员全是轨道」的项目整个从面板消失。
      const bucket =
        member.kind === "task" ? bucketByTaskId.get(member.id) : bucketByTrackId.get(member.id);
      if (bucket === undefined) continue;
      memberBuckets.push(bucket);
      const at =
        member.kind === "task" ? taskById.get(member.id)?.updatedAt : trackById.get(member.id)?.updatedAt;
      if (at !== undefined && (latest === null || at > latest)) latest = at;
    }
    const bucket = bucketForProject(memberBuckets);
    if (bucket === null) continue;
    items.push({
      key: `project:${goal.id}`,
      kind: "project",
      bucket,
      title: goal.title,
      taskId: null,
      trackId: null,
      goalId: goal.id,
      progress: {
        kind: "members",
        done: memberBuckets.filter((b) => b === "settled").length,
        total: memberBuckets.length,
      },
      lastActivityAt: latest,
      latestNote: null,
    });
  }

  return items.sort((a, b) => {
    const aMs = a.lastActivityAt === null ? 0 : new Date(a.lastActivityAt).getTime();
    const bMs = b.lastActivityAt === null ? 0 : new Date(b.lastActivityAt).getTime();
    return bMs - aMs;
  });
}
