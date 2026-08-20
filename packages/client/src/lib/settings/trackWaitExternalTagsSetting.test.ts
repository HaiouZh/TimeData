import { describe, expect, it } from "vitest";
import { DEFAULT_WAIT_EXTERNAL_TAGS, parseWaitExternalTags, sanitizeWaitExternalTags } from "./trackWaitExternalTagsSetting.js";

describe("sanitizeWaitExternalTags", () => {
  it("去重、去空、剥前导#、截 64 字", () => {
    expect(sanitizeWaitExternalTags(["#等外部", "等外部", " ", "等协作方"])).toEqual(["等外部", "等协作方"]);
    expect(sanitizeWaitExternalTags(["a".repeat(65)])).toEqual([]);
  });
  it("显式空数组保留为空（不归「等外部」组）", () => {
    expect(sanitizeWaitExternalTags([])).toEqual([]);
  });
  it("非数组回默认", () => {
    expect(sanitizeWaitExternalTags("等外部")).toEqual([...DEFAULT_WAIT_EXTERNAL_TAGS]);
  });
});

describe("parseWaitExternalTags", () => {
  it("未配置回默认", () => {
    expect(parseWaitExternalTags(null)).toEqual([...DEFAULT_WAIT_EXTERNAL_TAGS]);
    expect(parseWaitExternalTags(undefined)).toEqual([...DEFAULT_WAIT_EXTERNAL_TAGS]);
  });
  it("合法 JSON 数组按 sanitize 解析，空数组不回默认", () => {
    expect(parseWaitExternalTags('["等协作方"]')).toEqual(["等协作方"]);
    expect(parseWaitExternalTags("[]")).toEqual([]);
  });
  it("坏 JSON 回默认", () => {
    expect(parseWaitExternalTags("{oops")).toEqual([...DEFAULT_WAIT_EXTERNAL_TAGS]);
  });
});
