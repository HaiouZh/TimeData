import type { Task, Track, TrackStep } from "@timedata/shared";
import { placementForTask } from "./tasks/placement.js";
import { isTaskSunken, type TodoGravitySettings } from "./tasks/gravity.js";
import { STALL_THRESHOLD_MS } from "./tracksDispatch.js";
import { lastActivityAt } from "./tracksView.js";

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
}

/**
 * 任务落哪个推进桶；返回 null 表示不进面板（子任务 / 重复模板本体 / 已消解的发）。
 * 判定一律基于 placementForTask 的结果，不自行比较日期——时区口径只有一份。
 */
export function bucketForTask(task: Task, ctx: TaskBucketContext): ProgressBucket | null {
  if (task.parentId !== null) return null;
  if (task.recurrence !== null) return null;
  if (task.ruleId !== null && task.skipped) return null;

  const placement = placementForTask(task, ctx.now);
  if (placement.pool === "completed") return "settled";
  if (ctx.handSessionId !== null && task.sessionId === ctx.handSessionId) return "doing";
  if (placement.pool === "today") return "doing";
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
 * 队列里还有没有能动的），与 Task/Track 的时间式 waiting 是两套机制——
 * 项目有「下一步存在性」可算，单条任务没有。
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
