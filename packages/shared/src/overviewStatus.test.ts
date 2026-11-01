import { describe, expect, it } from "vitest";
import { computeOverviewClusterStatus, isOverviewStarDark, overviewTitlePrefix } from "./overviewStatus.js";

const now = new Date("2026-11-01T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe("computeOverviewClusterStatus", () => {
  it("没有动静 → empty", () => {
    expect(computeOverviewClusterStatus({ events: [], now })).toEqual({ status: "empty", lastActivityAt: null, quietDays: null });
  });
  it("只有固定重复 → fixed，最近动静取重复的那条", () => {
    expect(computeOverviewClusterStatus({ events: [{ kind: "recurring", at: ago(DAY) }], now })).toEqual({
      status: "fixed",
      lastActivityAt: ago(DAY),
      quietDays: 1,
    });
  });
  it("近 7 天有做完的 → moving", () => {
    const r = computeOverviewClusterStatus({
      events: [
        { kind: "done", at: ago(2 * DAY) },
        { kind: "input", at: ago(DAY) },
      ],
      now,
    });
    expect(r).toEqual({ status: "moving", lastActivityAt: ago(DAY), quietDays: 1 });
  });
  it("近 7 天有轨道动静 → moving", () => {
    expect(computeOverviewClusterStatus({ events: [{ kind: "progress", at: ago(3 * DAY) }], now }).status).toBe("moving");
  });
  it("近 7 天只有丢进来的 → saving", () => {
    const r = computeOverviewClusterStatus({
      events: [
        { kind: "input", at: ago(DAY) },
        { kind: "done", at: ago(20 * DAY) },
      ],
      now,
    });
    expect(r.status).toBe("saving");
  });
  it("恰好 7 天整仍算近期，多 1 毫秒就不算", () => {
    expect(computeOverviewClusterStatus({ events: [{ kind: "done", at: ago(7 * DAY) }], now }).status).toBe("moving");
    expect(computeOverviewClusterStatus({ events: [{ kind: "done", at: ago(7 * DAY + 1) }], now }).status).toBe("shelved");
  });
  it("搁着时 quietDays 按整天向下取整", () => {
    const r = computeOverviewClusterStatus({ events: [{ kind: "input", at: ago(11 * DAY + 23 * 3_600_000) }], now });
    expect(r).toMatchObject({ status: "shelved", quietDays: 11 });
  });
  it("固定重复的动静不让团变成在推进，也不算进最近动静", () => {
    const r = computeOverviewClusterStatus({
      events: [
        { kind: "recurring", at: ago(0) },
        { kind: "input", at: ago(20 * DAY) },
      ],
      now,
    });
    expect(r).toMatchObject({ status: "shelved", lastActivityAt: ago(20 * DAY), quietDays: 20 });
  });
  it("未来时刻：算近期，quietDays 记 0", () => {
    expect(computeOverviewClusterStatus({ events: [{ kind: "done", at: ahead(10 * DAY) }], now })).toMatchObject({
      status: "moving",
      quietDays: 0,
    });
  });
  it("带毫秒与不带毫秒的 ISO 串按真实时刻比较", () => {
    const a = computeOverviewClusterStatus({
      events: [
        { kind: "input", at: "2026-10-31T11:59:59.999Z" },
        { kind: "input", at: "2026-10-31T12:00:00Z" },
      ],
      now,
    });
    expect(a.lastActivityAt).toBe("2026-10-31T12:00:00Z");
    const b = computeOverviewClusterStatus({
      events: [
        { kind: "input", at: "2026-10-31T12:00:00.500Z" },
        { kind: "input", at: "2026-10-31T12:00:00Z" },
      ],
      now,
    });
    expect(b.lastActivityAt).toBe("2026-10-31T12:00:00.500Z");
  });
});

describe("isOverviewStarDark", () => {
  it("归了团的不沉", () => {
    expect(isOverviewStarDark({ assigned: true, pinned: false, at: ago(100 * DAY), now })).toBe(false);
  });
  it("置顶的不沉", () => {
    expect(isOverviewStarDark({ assigned: false, pinned: true, at: ago(100 * DAY), now })).toBe(false);
  });
  it("没归团：14 天整不沉，多 1 毫秒就沉", () => {
    expect(isOverviewStarDark({ assigned: false, pinned: false, at: ago(14 * DAY), now })).toBe(false);
    expect(isOverviewStarDark({ assigned: false, pinned: false, at: ago(14 * DAY + 1), now })).toBe(true);
  });
  it("未来时刻不沉", () => {
    expect(isOverviewStarDark({ assigned: false, pinned: false, at: ahead(20 * DAY), now })).toBe(false);
  });
});

describe("overviewTitlePrefix", () => {
  it.each<[string, string | null]>([
    ["Run · 步频视频脚本", "Run"],
    ["A · B · C", "A"],
    ["TimeData  ·  修同步", "TimeData"],
    ["A·B", null],
    [" · 只有后半", null],
    ["   · 前缀全是空格", null],
    ["没有分隔符", null],
    [`${"长".repeat(40)} · x`, "长".repeat(40)],
    [`${"长".repeat(41)} · x`, null],
  ])("%s → %s", (title, expected) => {
    expect(overviewTitlePrefix(title)).toBe(expected);
  });
});
