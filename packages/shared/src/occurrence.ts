import { TaskSchema } from "./entitySchemas.js";
import { currentDueDateString, isRecurrenceFinishedAfter } from "./recurrence.js";
import { localDateString, normalizeScheduledDate } from "./taskDates.js";
import type { Task } from "./types.js";

/** occurrence id 命名空间前缀，供反解 / 判别复用，避免字面量散落。 */
export const OCCURRENCE_ID_PREFIX = "occ:";

/**
 * 确定性 occurrence id = `occ:{ruleId}:{dueDate}`。
 * 契约：ruleId 为无冒号 uuid、dueDate 为 "YYYY-MM-DD"。同输入恒同输出 → 多设备物化幂等。
 */
export function occurrenceId(ruleId: string, dueDate: string): string {
  return `${OCCURRENCE_ID_PREFIX}${ruleId}:${dueDate}`;
}

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeOccurrenceDueDate(dueDate: string): string {
  if (!LOCAL_DATE_RE.test(dueDate)) throw new Error("dueDate must be YYYY-MM-DD");
  const scheduledAt = normalizeScheduledDate(dueDate);
  if (scheduledAt.slice(0, 10) !== dueDate) throw new Error("dueDate must be a valid local calendar date");
  return scheduledAt;
}

/**
 * 物化「模板 rule + 应发生日 dueDate」为一条 pending occurrence Task 行。
 * dueDate 契约 = 有效 "YYYY-MM-DD"（先严格校验，再走 normalizeScheduledDate 转 scheduledAt）。纯函数，不碰 rule。
 */
export function materializeOccurrence(rule: Task, dueDate: string, now: Date, sortOrder: number): Task {
  const nowIso = now.toISOString();
  const scheduledAt = normalizeOccurrenceDueDate(dueDate);
  return TaskSchema.parse({
    id: occurrenceId(rule.id, dueDate),
    parentId: null,
    title: rule.title,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [...(rule.tags ?? [])],
    ruleId: rule.id,
    skipped: false,
    sortOrder,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

/**
 * 计入账本的已处理 occurrence：属于该 rule、done||skipped、有 scheduledAt，且**不早于规则锚点**
 * （`startAt` 的本地日零点）。重锚（改规则/起始日会把 startAt 推到当下）后，锚点之前的历史发
 * 不再吃 count 配额、也不再推游标——历史行保留作账本事实，只是引擎不再计入（#4 方案 b）。
 */
function countedProcessedOccurrences(rule: Task, processed: Task[]): (Task & { scheduledAt: string })[] {
  const anchor = rule.startAt == null ? null : normalizeScheduledDate(localDateString(new Date(rule.startAt)));
  return processed
    .filter((o) => o.ruleId === rule.id && (o.done || o.skipped))
    .filter((o): o is Task & { scheduledAt: string } => o.scheduledAt != null)
    .filter((o) => anchor == null || o.scheduledAt >= anchor);
}

function latestProcessedOccurrence(rule: Task, processed: Task[]): Task | null {
  const occurrences = countedProcessedOccurrences(rule, processed);
  if (occurrences.length === 0) return null;
  // scheduledAt 同为定长 .sssZ，字典序===时间序，直接取 max。
  return occurrences.reduce((a, b) => (b.scheduledAt > a.scheduledAt ? b : a));
}

/**
 * 该 rule 名下「最新那一发」：scheduledAt 最大且非 skipped（含 active，与
 * latestProcessedOccurrence 的 done||skipped 口径不同）。
 */
export function latestOccurrenceForRule(ruleId: string, occurrences: Task[]): Task | null {
  const mine = occurrences
    .filter((o) => o.ruleId === ruleId && !o.skipped)
    .filter((o): o is Task & { scheduledAt: string } => o.scheduledAt != null);
  if (mine.length === 0) return null;
  // scheduledAt 定长 UtcIso，字典序===时间序。
  return mine.reduce((a, b) => (b.scheduledAt > a.scheduledAt ? b : a));
}

/** 该 rule 名下已处理(done||skipped) occurrence 的最新应发生日(scheduledAt UtcIso)；无则 null。 */
export function latestProcessedDueIso(rule: Task, processed: Task[]): string | null {
  return latestProcessedOccurrence(rule, processed)?.scheduledAt ?? null;
}

function latestProcessedCursorIso(rule: Task, processed: Task[]): string | null {
  const latest = latestProcessedOccurrence(rule, processed);
  if (latest == null) return null;
  if (rule.recurrence?.basis === "completion" && latest.done && latest.completedAt != null) return latest.completedAt;
  return latest.scheduledAt;
}

/** 重复规则是否已终结（count 满 或 until 过）——引擎不应再产下一个 occurrence。 */
export function isRuleExhausted(rule: Task, processed: Task[]): boolean {
  const recurrence = rule.recurrence;
  if (recurrence == null) return false;
  const mine = countedProcessedOccurrences(rule, processed);
  // count 腿：已处理条数达 count 即终结（>= 防多设备超发）。skip 计入配额。
  if (recurrence.count != null && mine.length >= recurrence.count) return true;
  // until 腿
  if (recurrence.until != null) {
    const latestIso = latestProcessedCursorIso(rule, processed);
    if (latestIso != null) {
      // 完成最新应发生日后是否再无发生
      return isRecurrenceFinishedAfter(recurrence, rule.startAt, latestIso);
    }
    // 空序列：首发是否已越过 until（本地零点 UtcIso 定长，字典序比较）
    const firstDueIso = normalizeScheduledDate(currentDueDateString(recurrence, null, rule.startAt));
    return firstDueIso > recurrence.until;
  }
  return false;
}

/**
 * 游标从 occurrence 序列推导下一个应发生日 "YYYY-MM-DD"；终结（count/until）返回 null。
 * due basis 用最新已处理 occurrence 的 scheduledAt 推进；completion basis 对 done occurrence
 * 用实际 completedAt 推进，skipped occurrence 无完成时刻则回退到 scheduledAt。
 */
export function nextDueDate(rule: Task, processed: Task[], now: string | Date = new Date()): string | null {
  const recurrence = rule.recurrence;
  if (recurrence == null) return null;
  if (isRuleExhausted(rule, processed)) return null;
  const latestIso = latestProcessedCursorIso(rule, processed);
  return currentDueDateString(recurrence, latestIso, rule.startAt, now);
}

/**
 * 物化引擎顶层入口：返回「现在该物化的那一条 pending occurrence」，或 null（无到期/已终结/下一发在未来）。
 * 逾期追平是「单行、逐次」——一次只产最早未处理的一发；追平多天靠调用方循环（产→标 done/skip 加进
 * processed→再调）。本函数无副作用、可重入，同 dueDate 靠确定性 id 幂等去重。
 */
export function materializeDue(rule: Task, processed: Task[], now: Date, sortOrder: number): Task | null {
  if (rule.recurrence == null) throw new Error("materializeDue requires a recurring rule");
  const mine = countedProcessedOccurrences(rule, processed);
  const dueDate = nextDueDate(rule, mine, now);
  if (dueDate == null) return null;
  // 逾期追平闸门：只物化 ≤ 今天的应发生日（未来发等到那天再物化）。定长 YYYY-MM-DD 字典序比较。
  if (dueDate > localDateString(now)) return null;
  return materializeOccurrence(rule, dueDate, now, sortOrder);
}
