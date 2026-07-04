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

function processedCursorIso(rule: Task, occurrence: Task & { scheduledAt: string }): string {
  if (rule.recurrence?.basis === "completion" && occurrence.done && occurrence.completedAt != null) {
    return occurrence.completedAt;
  }
  return occurrence.scheduledAt;
}

function latestProcessedCursorIsoFromCounted(rule: Task, occurrences: (Task & { scheduledAt: string })[]): string | null {
  if (occurrences.length === 0) return null;
  const latest = occurrences.reduce((a, b) => {
    const aCursor = processedCursorIso(rule, a);
    const bCursor = processedCursorIso(rule, b);
    if (bCursor > aCursor) return b;
    if (bCursor === aCursor && b.scheduledAt > a.scheduledAt) return b;
    return a;
  });
  return processedCursorIso(rule, latest);
}

function isAfterUntil(dueDate: string, until: string | null | undefined): boolean {
  return until != null && normalizeScheduledDate(dueDate) > until;
}

function skipProcessedDueDates(rule: Task, dueDate: string, processed: (Task & { scheduledAt: string })[]): string {
  if (rule.recurrence == null) return dueDate;
  const processedDueDates = new Set(processed.map((o) => o.scheduledAt.slice(0, 10)));
  const seenDueDates = new Set<string>();
  let next = dueDate;
  while (processedDueDates.has(next) && !seenDueDates.has(next)) {
    seenDueDates.add(next);
    next = currentDueDateString(rule.recurrence, normalizeScheduledDate(next), rule.startAt);
  }
  return next;
}

/**
 * 计入账本的已处理 occurrence：属于该 rule、done||skipped、有 scheduledAt，且通常**不早于规则锚点**
 * （`startAt` 的本地日零点）。重锚（改规则/起始日会把 startAt 推到当下）后，锚点之前的历史发
 * 不再吃 count 配额、也不再推游标——历史行保留作账本事实，只是引擎不再计入（#4 方案 b）。
 *
 * completion basis 的人工提前完成可能让后续应发生日早于锚点；只要它能从锚点后的已处理发继续推导
 * 出来，就仍计入当前账本，避免提前完成链条在锚点前卡死。
 */
function countedProcessedOccurrences(rule: Task, processed: Task[]): (Task & { scheduledAt: string })[] {
  const anchor = rule.startAt == null ? null : normalizeScheduledDate(localDateString(new Date(rule.startAt)));
  const mine = processed
    .filter((o) => o.ruleId === rule.id && (o.done || o.skipped))
    .filter((o): o is Task & { scheduledAt: string } => o.scheduledAt != null);
  if (anchor == null) return mine;

  const counted = mine.filter((o) => o.scheduledAt >= anchor);
  if (rule.recurrence?.basis !== "completion" || counted.length === 0) return counted;

  const countedIds = new Set(counted.map((o) => o.id));
  let changed = true;
  while (changed) {
    changed = false;
    const cursor = latestProcessedCursorIsoFromCounted(rule, counted);
    if (cursor == null) break;
    const dueDate = skipProcessedDueDates(rule, currentDueDateString(rule.recurrence, cursor, rule.startAt), counted);
    const dueIso = normalizeScheduledDate(dueDate);
    const matches = mine.filter((o) => !countedIds.has(o.id) && o.scheduledAt === dueIso);
    if (matches.length === 0) continue;
    for (const match of matches) {
      counted.push(match);
      countedIds.add(match.id);
    }
    changed = true;
  }

  return counted;
}

function latestProcessedOccurrence(rule: Task, processed: Task[]): Task | null {
  const occurrences = countedProcessedOccurrences(rule, processed);
  if (occurrences.length === 0) return null;
  // scheduledAt 同为定长 .sssZ，字典序===时间序，直接取 max。
  return occurrences.reduce((a, b) => (b.scheduledAt > a.scheduledAt ? b : a));
}

/**
 * 该 rule 名下当前可代理的一发：有 active pending 时优先 active；无 active 时回看 scheduledAt
 * 最大且非 skipped 的已处理发（与 latestProcessedOccurrence 的 done||skipped 口径不同）。
 */
export function latestOccurrenceForRule(ruleId: string, occurrences: Task[]): Task | null {
  const mine = occurrences
    .filter((o) => o.ruleId === ruleId && !o.skipped)
    .filter((o): o is Task & { scheduledAt: string } => o.scheduledAt != null);
  if (mine.length === 0) return null;
  const active = mine.filter((o) => !o.done);
  const candidates = active.length > 0 ? active : mine;
  // scheduledAt 定长 UtcIso，字典序===时间序。
  return candidates.reduce((a, b) => (b.scheduledAt > a.scheduledAt ? b : a));
}

/** 该 rule 名下已处理(done||skipped) occurrence 的最新应发生日(scheduledAt UtcIso)；无则 null。 */
export function latestProcessedDueIso(rule: Task, processed: Task[]): string | null {
  return latestProcessedOccurrence(rule, processed)?.scheduledAt ?? null;
}

function latestProcessedCursorIso(rule: Task, processed: Task[]): string | null {
  const occurrences = countedProcessedOccurrences(rule, processed);
  return latestProcessedCursorIsoFromCounted(rule, occurrences);
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
      if (isRecurrenceFinishedAfter(recurrence, rule.startAt, latestIso)) return true;
      if (recurrence.basis === "completion") {
        const nextDue = skipProcessedDueDates(rule, currentDueDateString(recurrence, latestIso, rule.startAt), mine);
        return isAfterUntil(nextDue, recurrence.until);
      }
      return false;
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
  const mine = countedProcessedOccurrences(rule, processed);
  if (isRuleExhausted(rule, mine)) return null;
  const latestIso = latestProcessedCursorIso(rule, processed);
  let dueDate = currentDueDateString(recurrence, latestIso, rule.startAt, now);
  if (recurrence.basis !== "completion") return dueDate;

  const processedDueDates = new Set(mine.map((o) => o.scheduledAt.slice(0, 10)));
  const seenDueDates = new Set<string>();
  while (processedDueDates.has(dueDate) && !seenDueDates.has(dueDate)) {
    seenDueDates.add(dueDate);
    dueDate = currentDueDateString(recurrence, normalizeScheduledDate(dueDate), rule.startAt, now);
  }
  if (isAfterUntil(dueDate, recurrence.until)) return null;
  return dueDate;
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
