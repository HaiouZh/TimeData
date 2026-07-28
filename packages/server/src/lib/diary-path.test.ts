import { describe, expect, it } from "vitest";
import path from "node:path";
import { expandDiaryTemplate, isValidDiaryDate, resolveDiaryFile } from "./diary-path.js";
import { expandWeeklyTemplate, isValidWeekKey, resolveWeeklyFile } from "./diary-path.js";

const TPL = "日记_{yyyy}/Day/{yyyy}年{MM}月/{yyyy}-{MM}-{dd}.md";

describe("isValidDiaryDate", () => {
  it("接受合法日期", () => {
    expect(isValidDiaryDate("2026-07-09")).toBe(true);
  });
  it("拒绝格式错误与假日期", () => {
    expect(isValidDiaryDate("2026-7-9")).toBe(false);
    expect(isValidDiaryDate("2026-02-30")).toBe(false);
    expect(isValidDiaryDate("../etc")).toBe(false);
  });
});

describe("expandDiaryTemplate", () => {
  it("按日期展开占位符", () => {
    expect(expandDiaryTemplate(TPL, "2026-07-09")).toBe("日记_2026/Day/2026年07月/2026-07-09.md");
  });
  it("拒绝 .. / 绝对路径 / 盘符 / 反斜杠 / 空模板", () => {
    expect(() => expandDiaryTemplate("../{yyyy}.md", "2026-07-09")).toThrow();
    expect(() => expandDiaryTemplate("/abs/{yyyy}.md", "2026-07-09")).toThrow();
    expect(() => expandDiaryTemplate("C:/x/{yyyy}.md", "2026-07-09")).toThrow();
    expect(() => expandDiaryTemplate("a\\b/{yyyy}.md", "2026-07-09")).toThrow();
    expect(() => expandDiaryTemplate("  ", "2026-07-09")).toThrow();
  });
  it("拒绝未知占位符与非法日期", () => {
    expect(() => expandDiaryTemplate("{yy}.md", "2026-07-09")).toThrow();
    expect(() => expandDiaryTemplate(TPL, "2026-02-30")).toThrow();
  });
});

describe("resolveDiaryFile", () => {
  it("返回 vault 内绝对路径", () => {
    const vault = path.resolve("/tmp/vault");
    expect(resolveDiaryFile(vault, TPL, "2026-07-09")).toBe(
      path.join(vault, "日记_2026", "Day", "2026年07月", "2026-07-09.md"),
    );
  });
});

describe("周记模板", () => {
  it("isValidWeekKey 只认 YYYY-Www 且周号 01–53", () => {
    expect(isValidWeekKey("2026-W31")).toBe(true);
    expect(isValidWeekKey("2026-W00")).toBe(false);
    expect(isValidWeekKey("2026-W54")).toBe(false);
    expect(isValidWeekKey("2026-31")).toBe(false);
    expect(isValidWeekKey("2026-w31")).toBe(false);
  });
  it("expandWeeklyTemplate 展开 {gggg}/{ww}", () => {
    expect(expandWeeklyTemplate("Reviews/{gggg}/{gggg}-W{ww}.md", "2026-W05")).toBe("Reviews/2026/2026-W05.md");
  });
  it("拒绝未知占位符与越界路径", () => {
    expect(() => expandWeeklyTemplate("{yyyy}.md", "2026-W05")).toThrow("未知占位符");
    expect(() => expandWeeklyTemplate("../{gggg}.md", "2026-W05")).toThrow();
    expect(() => resolveWeeklyFile("/vault", "a/../../{ww}.md", "2026-W05")).toThrow();
  });
});
