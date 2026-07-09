import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_EXEC_TAGS, parseAgentExecTags, sanitizeAgentExecTags } from "./trackAgentExecTagsSetting.js";

describe("sanitizeAgentExecTags", () => {
  it("去重、去空、剥前导#、截 64 字", () => {
    expect(sanitizeAgentExecTags(["#agent在做", "agent在做", " ", "codex跑批"])).toEqual(["agent在做", "codex跑批"]);
    expect(sanitizeAgentExecTags(["a".repeat(65)])).toEqual([]);
  });
  it("显式空数组保留为空（不归「agent 在跑」组）", () => {
    expect(sanitizeAgentExecTags([])).toEqual([]);
  });
  it("非数组回默认", () => {
    expect(sanitizeAgentExecTags("agent在做")).toEqual([...DEFAULT_AGENT_EXEC_TAGS]);
  });
});

describe("parseAgentExecTags", () => {
  it("未配置回默认", () => {
    expect(parseAgentExecTags(null)).toEqual([...DEFAULT_AGENT_EXEC_TAGS]);
    expect(parseAgentExecTags(undefined)).toEqual([...DEFAULT_AGENT_EXEC_TAGS]);
  });
  it("合法 JSON 数组按 sanitize 解析，空数组不回默认", () => {
    expect(parseAgentExecTags('["机器人在做"]')).toEqual(["机器人在做"]);
    expect(parseAgentExecTags("[]")).toEqual([]);
  });
  it("坏 JSON 回默认", () => {
    expect(parseAgentExecTags("{oops")).toEqual([...DEFAULT_AGENT_EXEC_TAGS]);
  });
});
