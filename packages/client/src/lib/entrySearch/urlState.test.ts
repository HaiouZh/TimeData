import { describe, expect, it } from "vitest";
import { parseSearchUrlState, toSearchUrlParams } from "./urlState.js";

const TODAY = "2026-02-14";

describe("parseSearchUrlState", () => {
  it("空参数回落默认：无分类、year 档、锚点为今天、空查询", () => {
    expect(parseSearchUrlState(new URLSearchParams(""), TODAY)).toEqual({
      categoryId: null,
      mode: "year",
      anchor: TODAY,
      query: "",
    });
  });

  it("完整参数原样解析", () => {
    const params = new URLSearchParams("cat=cat-sleep-nap&range=month&anchor=2026-01-05&q=%E8%A1%A5%E8%A7%89");
    expect(parseSearchUrlState(params, TODAY)).toEqual({
      categoryId: "cat-sleep-nap",
      mode: "month",
      anchor: "2026-01-05",
      query: "补觉",
    });
  });

  it("未知 range 回落 year", () => {
    expect(parseSearchUrlState(new URLSearchParams("range=decade"), TODAY).mode).toBe("year");
  });

  it("非法 anchor 回落今天", () => {
    expect(parseSearchUrlState(new URLSearchParams("anchor=2026-13-99"), TODAY).anchor).toBe(TODAY);
    expect(parseSearchUrlState(new URLSearchParams("anchor=garbage"), TODAY).anchor).toBe(TODAY);
  });

  it("空字符串 cat 视为未选分类", () => {
    expect(parseSearchUrlState(new URLSearchParams("cat="), TODAY).categoryId).toBeNull();
  });

  it("四档 range 全部可解析", () => {
    for (const mode of ["all", "year", "month", "week"] as const) {
      expect(parseSearchUrlState(new URLSearchParams(`range=${mode}`), TODAY).mode).toBe(mode);
    }
  });
});

describe("toSearchUrlParams", () => {
  it("全默认时产出空参数", () => {
    const params = toSearchUrlParams({ categoryId: null, mode: "year", anchor: TODAY, query: "" }, TODAY);
    expect(params.toString()).toBe("");
  });

  it("只序列化偏离默认的字段", () => {
    const params = toSearchUrlParams({ categoryId: "cat-sleep", mode: "year", anchor: TODAY, query: "" }, TODAY);
    expect(params.toString()).toBe("cat=cat-sleep");
  });

  it("往返一致", () => {
    const state = { categoryId: "cat-sleep-nap", mode: "week" as const, anchor: "2026-01-05", query: "补觉" };
    expect(parseSearchUrlState(toSearchUrlParams(state, TODAY), TODAY)).toEqual(state);
  });

  it("纯空白查询照样进 URL，保证往返一致", () => {
    const state = { categoryId: null, mode: "year" as const, anchor: TODAY, query: "   " };
    const params = toSearchUrlParams(state, TODAY);
    expect(params.get("q")).toBe("   ");
    expect(parseSearchUrlState(params, TODAY)).toEqual(state);
  });
});
