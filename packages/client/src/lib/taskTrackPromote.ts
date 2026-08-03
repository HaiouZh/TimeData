import type { Task, Track } from "@timedata/shared";
import { findActiveTrackForTask } from "./taskTrackIndex.js";
import { toggleTaskDone } from "./tasks.js";
import { addTrack, listTracks, setTrackStatus } from "./tracks.js";

// RefSchema 的 label 上限（entitySchemas.ts RefSchema：z.string().max(200)）。
const REF_LABEL_MAX = 200;

/**
 * todo 任务一键升格挂轨道：建 active 轨道、标题复用、refs 指回任务；任务本体不动。
 * 幂等：已挂 active 轨道直接返回既有轨道。落点是本文件而不是 tasks.ts / tracks.ts：
 * 两者是平级互不 import 的兄弟，task↔track 复合动作只能放上层（同 taskNesting.ts 先例）。
 */
export async function promoteTaskToTrack(task: Task, now: Date = new Date()): Promise<Track> {
  const existing = findActiveTrackForTask(await listTracks("active"), task.id);
  if (existing !== null) return existing;
  return addTrack({
    title: task.title,
    refs: [{ kind: "task", id: task.id, label: task.title.slice(0, REF_LABEL_MAX) }],
    now,
  });
}

/**
 * 勾选 + 附带归档：勾掉任务后若其挂载轨道仍 active，自动 setTrackStatus("concluded")
 * （既有机制闭合开口步 + 写「归档」系统步留痕）。单向：取消勾选不重开轨道。
 * 勾选是主动作、归档是附带动作，刻意不进同一事务：归档失败只 warn，勾选不回滚，
 * 轨道留在调度台可手动归档。签名与 toggleTaskDone 一致，调用点可直接替换。
 */
export async function toggleTaskDoneWithTrackConclude(
  id: string,
  options: { now?: Date } = {},
): Promise<Task> {
  const next = await toggleTaskDone(id, options);
  if (!next.done) return next;
  try {
    const track = findActiveTrackForTask(await listTracks("active"), next.id);
    if (track !== null) await setTrackStatus(track.id, "concluded", { now: options.now });
  } catch (error) {
    console.warn("[taskTrackPromote] 勾选后归档轨道失败（勾选本身已生效）", error);
  }
  return next;
}
