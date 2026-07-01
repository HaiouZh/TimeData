import { describe, expect, it } from "vitest";
import {
  isRuleExhausted,
  materializeDue,
  materializeOccurrence,
  nextDueDate,
  OCCURRENCE_ID_PREFIX,
  occurrenceId,
} from "./occurrence.js";
import { TaskSchema } from "./schemas.js";
import { localDateOf, normalizeScheduledDate } from "./taskDates.js";
import type { Recurrence, Task } from "./types.js";

function baseTask(over: Partial<Task> = {}): Task {
  return TaskSchema.parse({
    id: "t1",
    title: "任务",
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...over,
  });
}
const dailyRule = (over: Partial<Recurrence> = {}): Recurrence => ({
  freq: "daily",
  interval: 1,
  basis: "due",
  ...over,
});
function baseRule(over: Partial<Task> = {}): Task {
  return baseTask({ id: "r1", recurrence: dailyRule(), startAt: normalizeScheduledDate("2026-07-01"), ...over });
}
function occ(ruleId: string, dueDate: string, over: Partial<Task> = {}): Task {
  return baseTask({
    id: occurrenceId(ruleId, dueDate),
    ruleId,
    recurrence: null,
    scheduledAt: normalizeScheduledDate(dueDate),
    done: true,
    ...over,
  });
}

describe("occurrenceId", () => {
  const rid = "a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab";
  it("确定性：同输入恒同输出，格式 occ:{ruleId}:{date}", () => {
    expect(occurrenceId(rid, "2026-07-01")).toBe(occurrenceId(rid, "2026-07-01"));
    expect(occurrenceId(rid, "2026-07-01")).toBe(`${OCCURRENCE_ID_PREFIX}${rid}:2026-07-01`);
  });
  it("命名空间：occ: 前缀，不与裸 uuid 撞", () => {
    const id = occurrenceId(rid, "2026-07-01");
    expect(id.startsWith(OCCURRENCE_ID_PREFIX)).toBe(true);
    expect(id).not.toBe(rid);
  });
  it("单射：不同应发生日 / 不同 rule → 不同 id", () => {
    expect(occurrenceId(rid, "2026-07-01")).not.toBe(occurrenceId(rid, "2026-07-02"));
    expect(occurrenceId("11111111-1111-4111-8111-111111111111", "2026-07-01")).not.toBe(
      occurrenceId("22222222-2222-4222-8222-222222222222", "2026-07-01"),
    );
  });
});

describe("materializeOccurrence", () => {
  it("物化 daily 应发生日为 pending occurrence（字段形态）", () => {
    const rule = baseRule({ id: "r-1", title: "跑步", tags: ["health"], startAt: localDateOf(new Date(2026, 5, 19)) });
    const now = new Date("2026-06-19T08:00:00.000Z");
    const occurrence = materializeOccurrence(rule, "2026-06-19", now, 5);
    expect(occurrence.id).toBe(occurrenceId("r-1", "2026-06-19"));
    expect(occurrence.ruleId).toBe("r-1");
    expect(occurrence.recurrence).toBeNull();
    expect(occurrence.done).toBe(false);
    expect(occurrence.skipped).toBe(false);
    expect(occurrence.completedAt).toBeNull();
    expect(occurrence.scheduledAt).toBe(localDateOf(new Date(2026, 5, 19)));
    expect(occurrence.sortOrder).toBe(5);
    expect(occurrence.title).toBe("跑步");
    expect(occurrence.createdAt).toBe(now.toISOString());
  });
  it("确定性 id：同 (rule,dueDate) 两次物化恒同 id（now/sortOrder 不同）", () => {
    const rule = baseRule({ id: "r-2" });
    const a = materializeOccurrence(rule, "2026-07-10", new Date("2026-07-10T01:00:00.000Z"), 1);
    const b = materializeOccurrence(rule, "2026-07-10", new Date("2026-07-10T20:00:00.000Z"), 9);
    expect(a.id).toBe(b.id);
  });
  it("tags 与 rule 不共享引用、不污染 rule", () => {
    const rule = baseRule({ id: "r-4", tags: ["a", "b"] });
    const occurrence = materializeOccurrence(rule, "2026-07-05", new Date("2026-07-05T00:00:00.000Z"), 0);
    expect(occurrence.tags).toEqual(["a", "b"]);
    expect(occurrence.tags).not.toBe(rule.tags);
    occurrence.tags.push("c");
    expect(rule.tags).toEqual(["a", "b"]);
  });
  it("非法 dueDate 抛错而非产脏行", () => {
    const rule = baseRule({ id: "r-9" });
    expect(() => materializeOccurrence(rule, "2026-13-40", new Date("2026-07-01T00:00:00.000Z"), 0)).toThrow();
  });
});

describe("isRuleExhausted", () => {
  it("count=3：3 发已处理（done/skip 混合）→ 终结", () => {
    const rule = baseRule({ recurrence: dailyRule({ count: 3 }) });
    const processed = [
      occ(rule.id, "2026-07-01", { done: true }),
      occ(rule.id, "2026-07-02", { done: false, skipped: true }),
      occ(rule.id, "2026-07-03", { done: true }),
    ];
    expect(isRuleExhausted(rule, processed)).toBe(true);
  });
  it("count=3：仅 2 发 → 不终结", () => {
    const rule = baseRule({ recurrence: dailyRule({ count: 3 }) });
    expect(isRuleExhausted(rule, [occ(rule.id, "2026-07-01"), occ(rule.id, "2026-07-02")])).toBe(false);
  });
  it("skip 计入 count 配额：全 skip 也耗尽", () => {
    const rule = baseRule({ recurrence: dailyRule({ count: 2 }) });
    const processed = [
      occ(rule.id, "2026-07-01", { done: false, skipped: true }),
      occ(rule.id, "2026-07-02", { done: false, skipped: true }),
    ];
    expect(isRuleExhausted(rule, processed)).toBe(true);
  });
  it("until daily：最新已处理=until 当天 → 终结（下一格越界）", () => {
    const rule = baseRule({ recurrence: dailyRule({ until: normalizeScheduledDate("2026-07-03") }) });
    const processed = [occ(rule.id, "2026-07-02"), occ(rule.id, "2026-07-03")];
    expect(isRuleExhausted(rule, processed)).toBe(true);
  });
  it("until daily：最新=until 前一天 → 不终结（次日==until 仍应产）", () => {
    const rule = baseRule({ recurrence: dailyRule({ until: normalizeScheduledDate("2026-07-03") }) });
    expect(isRuleExhausted(rule, [occ(rule.id, "2026-07-02")])).toBe(false);
  });
  it("until 空序列：startAt 晚于 until → 立即终结；startAt==until → 不终结", () => {
    const late = baseRule({
      startAt: normalizeScheduledDate("2026-07-05"),
      recurrence: dailyRule({ until: normalizeScheduledDate("2026-07-01") }),
    });
    expect(isRuleExhausted(late, [])).toBe(true);
    const eq = baseRule({
      startAt: normalizeScheduledDate("2026-07-05"),
      recurrence: dailyRule({ until: normalizeScheduledDate("2026-07-05") }),
    });
    expect(isRuleExhausted(eq, [])).toBe(false);
  });
  it("无 count 无 until：永不终结；最新按 scheduledAt max 取（乱序）", () => {
    const rule = baseRule({ recurrence: dailyRule() });
    const many = Array.from({ length: 20 }, (_, i) => occ(rule.id, `2026-07-${String(i + 1).padStart(2, "0")}`));
    expect(isRuleExhausted(rule, many)).toBe(false);
  });
});

describe("nextDueDate", () => {
  it("空序列：下一个应发生日 = startAt 当天", () => {
    const rule = baseRule({ startAt: localDateOf(new Date(2026, 5, 10)) });
    expect(nextDueDate(rule, [])).toBe("2026-06-10");
  });
  it("单条已处理 daily：推进一天", () => {
    const rule = baseRule({ startAt: localDateOf(new Date(2026, 5, 10)) });
    expect(nextDueDate(rule, [occ(rule.id, "2026-06-10")])).toBe("2026-06-11");
  });
  it("daily interval3：游标后隔 3 天", () => {
    const rule = baseRule({ recurrence: dailyRule({ interval: 3 }), startAt: localDateOf(new Date(2026, 5, 1)) });
    expect(nextDueDate(rule, [occ(rule.id, "2026-06-04")])).toBe("2026-06-07");
  });
  it("weekly [一三五]：周五游标推到下周一", () => {
    const rule = baseRule({
      recurrence: { freq: "weekly", interval: 1, byWeekday: [1, 3, 5], basis: "due" },
      startAt: localDateOf(new Date(2026, 5, 1)),
    });
    expect(nextDueDate(rule, [occ(rule.id, "2026-06-05")])).toBe("2026-06-08");
  });
  it("monthly 月末(-1)：当月末游标推到下月末", () => {
    const rule = baseRule({
      recurrence: { freq: "monthly", interval: 1, byMonthday: [-1], basis: "due" },
      startAt: localDateOf(new Date(2026, 0, 31)),
    });
    expect(nextDueDate(rule, [occ(rule.id, "2026-01-31")])).toBe("2026-02-28");
  });
  it("已终结（count 满）→ null", () => {
    const rule = baseRule({ recurrence: dailyRule({ count: 1 }) });
    expect(nextDueDate(rule, [occ(rule.id, "2026-07-01")])).toBeNull();
  });
  it("乱序 processed：按 scheduledAt max 取游标", () => {
    const rule = baseRule({ startAt: localDateOf(new Date(2026, 5, 1)) });
    const processed = [occ(rule.id, "2026-06-03"), occ(rule.id, "2026-06-01"), occ(rule.id, "2026-06-02")];
    expect(nextDueDate(rule, processed)).toBe("2026-06-04");
  });
  it("completion basis：done occurrence 按实际 completedAt 推进，而不是 scheduledAt", () => {
    const rule = baseRule({
      recurrence: dailyRule({ interval: 3, basis: "completion" }),
      startAt: localDateOf(new Date(2026, 5, 1)),
    });
    const processed = [
      occ(rule.id, "2026-06-06", {
        completedAt: "2026-06-10T09:00:00.000Z",
      }),
    ];
    expect(nextDueDate(rule, processed)).toBe("2026-06-13");
  });
  it("completion basis：skipped occurrence 无 completedAt，按 scheduledAt 推进", () => {
    const rule = baseRule({
      recurrence: dailyRule({ interval: 3, basis: "completion" }),
      startAt: localDateOf(new Date(2026, 5, 1)),
    });
    const processed = [
      occ(rule.id, "2026-06-06", {
        done: false,
        skipped: true,
      }),
    ];
    expect(nextDueDate(rule, processed)).toBe("2026-06-09");
  });
});

describe("materializeDue", () => {
  it("到期未处理 → 产当天 pending occurrence", () => {
    const rule = baseRule({ id: "r-1", startAt: localDateOf(new Date(2026, 6, 1)) });
    const now = new Date("2026-07-01T09:00:00.000Z");
    const occurrence = materializeDue(rule, [], now, 0);
    expect(occurrence?.id).toBe(occurrenceId("r-1", "2026-07-01"));
    expect(occurrence?.done).toBe(false);
    expect(occurrence?.scheduledAt).toBe(localDateOf(new Date(2026, 6, 1)));
  });
  it("下一应发生日 > 今天 → null（未来发不物化）", () => {
    const rule = baseRule({ startAt: localDateOf(new Date(2026, 6, 10)) });
    expect(materializeDue(rule, [], new Date("2026-07-01T09:00:00.000Z"), 0)).toBeNull();
  });
  it("逾期追平·单行·逐次：漏 3 天先产最早那一发，标 done 后再调得下一发", () => {
    const rule = baseRule({ id: "r-2", startAt: localDateOf(new Date(2026, 6, 1)) });
    const now = new Date("2026-07-04T09:00:00.000Z"); // 今天 07-04，漏了 01/02/03
    const first = materializeDue(rule, [], now, 0);
    expect(first?.scheduledAt).toBe(localDateOf(new Date(2026, 6, 1))); // 只产最早的 07-01，不堆 3 个
    const second = materializeDue(rule, [{ ...first!, done: true }], now, 1);
    expect(second?.scheduledAt).toBe(localDateOf(new Date(2026, 6, 2))); // 处理后前进到 07-02
  });
  it("已终结 → null", () => {
    const rule = baseRule({ recurrence: dailyRule({ count: 1 }) });
    expect(materializeDue(rule, [occ(rule.id, "2026-07-01")], new Date("2026-07-05T09:00:00.000Z"), 0)).toBeNull();
  });
  it("非重复 rule 传入 → 抛错（防误用）", () => {
    expect(() => materializeDue(baseTask({ recurrence: null }), [], new Date(), 0)).toThrow();
  });
});
