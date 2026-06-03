import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "./looksLikeMarkdown.js";

describe("looksLikeMarkdown", () => {
  it.each([
    "# 标题",
    "- 待办一\n- 待办二",
    "1. 第一\n2. 第二",
    "- [ ] 未完成\n- [x] 完成",
    "> 引用",
    "```\ncode\n```",
    "见 [文档](https://example.com)",
    "用 `pnpm test` 跑测试",
    "**重点**",
    "~~删除~~",
    "| a | b |\n| - | - |\n| 1 | 2 |",
  ])("结构语法触发渲染：%s", (text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    "今天去买菜，然后写代码",
    "看 https://example.com/path_with_under_score 这个链接",
    "路径是 C:\\Users\\me\\file.txt",
    "她说*大概*这样吧",
    "进度 50% 完成 * 注意",
  ])("纯文本保持原样：%s", (text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});
