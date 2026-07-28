import { describe, expect, it } from "vitest";
import { preprocessDiaryMarkdown } from "./reviewMarkdown.js";

describe("preprocessDiaryMarkdown", () => {
  it("wikilink 图片转标准语法", () => {
    expect(preprocessDiaryMarkdown("![[photo.png]]")).toBe("![](td-asset:photo.png)");
    expect(preprocessDiaryMarkdown("![[a/b.jpg|风景]]")).toBe("![风景](td-asset:a/b.jpg)");
  });

  it("内部链接降为纯文本", () => {
    expect(preprocessDiaryMarkdown("见 [[2026-01-01]] 和 [[页面|别名]]")).toBe("见 2026-01-01 和 别名");
  });

  it("正文里裸文件名不被当图片（贪婪匹配反例）", () => {
    expect(preprocessDiaryMarkdown("今天整理了 a.png 这个文件")).toBe("今天整理了 a.png 这个文件");
  });

  it("非图片嵌入降为文件名", () => {
    expect(preprocessDiaryMarkdown("![[笔记.md]]")).toBe("笔记.md");
  });

  it("路径含空格/括号/井号时逐段编码，产物仍是合法 markdown 图片", () => {
    // 不编码的话 `![](td-asset:我的 照片.png)` 会在空格处断开，图片丢失。
    expect(preprocessDiaryMarkdown("![[附件/我的 照片.png]]")).toBe(
      "![](td-asset:%E9%99%84%E4%BB%B6/%E6%88%91%E7%9A%84%20%E7%85%A7%E7%89%87.png)",
    );
    expect(preprocessDiaryMarkdown("![[a (1).png]]")).toBe("![](td-asset:a%20(1).png)");
    expect(preprocessDiaryMarkdown("![[c#d.png]]")).toBe("![](td-asset:c%23d.png)");
  });

  it("同一行两个图片嵌入分别改写，不被贪婪并成一个", () => {
    expect(preprocessDiaryMarkdown("![[a.png]] ![[b.png]]")).toBe("![](td-asset:a.png) ![](td-asset:b.png)");
  });
});
