import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 行尾归一见 indexCssTokens.test.ts：仓库在 Windows 上检出会带 CRLF，正则里的 \n 匹配不到。
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("index.html 恢复期兜底", () => {
  it("内联底色，覆盖重载到 React 挂载的全程", () => {
    // index.css 的 body 没有 background——底色来自 React 根节点的 bg-page。
    // iOS 回收 WKWebView 渲染进程后会整页重载，React 挂载前那几百毫秒会是系统默认白。
    // 这条断言守的就是那段兜底样式，删掉即白屏回归。
    expect(html).toMatch(/<style>[\s\S]*?html\s*,\s*body\s*\{[\s\S]*?background:\s*#0e1320/);
  });

  it("内联预连接，让跨太平洋握手与 JS 解析并行", () => {
    expect(html).toContain("timedata_api_url");
    expect(html).toContain('"preconnect"');
  });
});
