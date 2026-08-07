import type { Task, Track } from "@timedata/shared";
import { db } from "../db/index.js";
import { findActiveTrackForTask } from "./taskTrackIndex.js";
import { toggleTaskDone } from "./tasks.js";
import { addTrack, listTracks, setTrackStatus } from "./tracks.js";

// RefSchema 的 label 上限（entitySchemas.ts RefSchema：z.string().max(200)）。
const REF_LABEL_MAX = 200;

/**
 * 按 UTF-16 code unit 截断，但不把 emoji 从中间劈开。
 * `slice` 切在代理对中间会留一个孤立高代理（0xD800-0xDBFF）——它仍能过 `z.string().max(200)`，
 * 却在渲染 / JSON 序列化时变成乱码字符，故末位是孤立高代理时再退一格。
 */
function sliceWithoutLoneSurrogate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * todo 任务一键升格挂轨道：建 active 轨道、标题复用、refs 指回任务；任务本体不动。
 * 幂等：已挂 active 轨道直接返回既有轨道。落点是本文件而不是 tasks.ts / tracks.ts：
 * 两者是平级互不 import 的兄弟，task↔track 复合动作只能放上层（同 taskNesting.ts 先例）。
 *
 * 幂等靠「先查后建」，中间隔一次异步 DB 读——同一拍内的重复调用两边都会读到「未挂轨道」。
 * 这道 check-then-act 由调用方的 in-flight 守卫兜（见 TaskDetailSheet 升格按钮），
 * 数据层不加锁：跨标签页本来也锁不住，成本收益不划算。
 */
export async function promoteTaskToTrack(task: Task, now: Date = new Date()): Promise<Track> {
  const existing = findActiveTrackForTask(await listTracks("active"), task.id);
  if (existing !== null) return existing;
  return addTrack({
    title: task.title,
    refs: [{ kind: "task", id: task.id, label: sliceWithoutLoneSurrogate(task.title, REF_LABEL_MAX) }],
    now,
  });
}

export interface ToggleWithTrackConcludeResult {
  task: Task;
  /** 本次勾选附带归档的轨道；未归档（没挂 / 非 active / 取消勾选 / 归档失败）恒 null。 */
  concludedTrack: Track | null;
}

/**
 * 勾选 + 附带归档：勾掉任务后若其挂载轨道仍 active，自动 setTrackStatus("concluded")
 * （既有机制闭合开口步 + 写「归档」系统步留痕）。单向：取消勾选不重开轨道。
 * 勾选是主动作、归档是附带动作，刻意不进同一事务：归档失败只 warn，勾选不回滚，
 * 轨道留在调度台可手动归档。
 *
 * 返回值把「有没有真归档」交出去：调用方据 `concludedTrack` 决定要不要给撤销 toast，
 * 归档静默失败时它恒 null，不会伪装成成功。
 */
export async function toggleTaskDoneWithTrackConclude(
  id: string,
  options: { now?: Date } = {},
): Promise<ToggleWithTrackConcludeResult> {
  const task = await toggleTaskDone(id, options);
  if (!task.done) return { task, concludedTrack: null };
  try {
    const track = findActiveTrackForTask(await listTracks("active"), task.id);
    if (track === null) return { task, concludedTrack: null };
    const { track: concluded } = await setTrackStatus(track.id, "concluded", { now: options.now });
    return { task, concludedTrack: concluded };
  } catch (error) {
    console.warn("[taskTrackPromote] 勾选后归档轨道失败（勾选本身已生效）", error);
    return { task, concludedTrack: null };
  }
}

/**
 * 撤销「勾选附带归档」：取消勾选任务 + 把轨道重开为 active，两件事都回退。
 * 两步串行、不同事务（同 `toggleTaskDoneWithTrackConclude` 的既有取舍）：中途失败可重试，
 * 不做补偿回滚——轨道与任务各自都留在能手动收拾的状态。
 */
export async function undoToggleWithTrackConclude(
  taskId: string,
  trackId: string,
  options: { now?: Date } = {},
): Promise<void> {
  // 先读当前态再决定翻不翻：`toggleTaskDone` 是**翻转**、不接受目标状态。提示存活数秒（todo 侧 6 秒 / 目标图侧 5 秒），
  // 期间用户完全可能自己已经取消过勾选——那时再无条件 toggle 会把任务反向勾成已完成，
  // 与「撤销 = 回退」正好相反。只有仍停在已完成态时才需要翻回去。
  const current = await db.tasks.get(taskId);
  if (current?.done === true) await toggleTaskDone(taskId, options);
  await setTrackStatus(trackId, "active", { now: options.now });
}

export interface TrackConcludeUndo {
  message: string;
  onUndo: () => Promise<void>;
}

/**
 * 把「勾选附带归档」的结果翻译成撤销提示所需的文案与回退动作；没真归档时返回 null。
 * 四个调用点（待办列表 / 任务详情抽屉 / 目标图编辑器 / 目标星图）共用它，文案与回退口径只有这一份；
 * 落地组件仍是两套（todo 侧 `ActionToastBar` / goals 侧 `GoalGraphUndoToast`），只差自动消失时长。
 */
export function buildTrackConcludeUndo(result: ToggleWithTrackConcludeResult): TrackConcludeUndo | null {
  const { task, concludedTrack } = result;
  if (concludedTrack === null) return null;
  return {
    message: `已归档轨道「${concludedTrack.title}」`,
    onUndo: () => undoToggleWithTrackConclude(task.id, concludedTrack.id),
  };
}
