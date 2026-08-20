import { describe, expect, it } from "vitest";
import { DEFAULT_RESUME_TAGS, parseResumeTags, sanitizeResumeTags } from "./trackResumeTagsSetting.js";

describe("sanitizeResumeTags", () => {
  it("去重、去空、剥前导#、截 64 字", () => {
    expect(sanitizeResumeTags(["#推进中", "推进中", " ", "继续推进"])).toEqual(["推进中", "继续推进"]);
    expect(sanitizeResumeTags(["a".repeat(65)])).toEqual([]);
  });
  it("显式空数组保留为空（不归「推进中」组）", () => {
    expect(sanitizeResumeTags([])).toEqual([]);
  });
  it("非数组回默认", () => {
    expect(sanitizeResumeTags("推进中")).toEqual([...DEFAULT_RESUME_TAGS]);
  });
});

describe("parseResumeTags", () => {
  it("未配置回默认", () => {
    expect(parseResumeTags(null)).toEqual([...DEFAULT_RESUME_TAGS]);
    expect(parseResumeTags(undefined)).toEqual([...DEFAULT_RESUME_TAGS]);
  });
  it("合法 JSON 数组按 sanitize 解析，空数组不回默认", () => {
    expect(parseResumeTags('["继续推进"]')).toEqual(["继续推进"]);
    expect(parseResumeTags("[]")).toEqual([]);
  });
  it("坏 JSON 回默认", () => {
    expect(parseResumeTags("{oops")).toEqual([...DEFAULT_RESUME_TAGS]);
  });
});
