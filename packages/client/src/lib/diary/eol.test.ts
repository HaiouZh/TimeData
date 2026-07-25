import { describe, expect, it } from "vitest";
import { detectEol } from "./eol.js";

// 9 条实测输入：docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/4-键位语义.md §3.2
// 与同目录 p2keys-eol.mjs 原型实跑产出，直接抄自该文档。
describe("detectEol", () => {
  it("空字符串：无换行，判 LF", () => {
    expect(detectEol("")).toBe("\n");
  });

  it("无换行的单行文本：判 LF", () => {
    expect(detectEol("a")).toBe("\n");
  });

  it("纯 LF 文本：判 LF", () => {
    expect(detectEol("a\nb")).toBe("\n");
  });

  it("CRLF 与 LF 各一处，1:1 平局：判 LF", () => {
    expect(detectEol("a\r\nb\nc")).toBe("\n");
  });

  it("孤立 \\r（老 Mac 行尾），不计入 CRLF 也不计入 LF：判 LF", () => {
    expect(detectEol("a\rb")).toBe("\n");
  });

  it("LF 与 CRLF 各一处，顺序调换，仍是 1:1 平局：判 LF", () => {
    expect(detectEol("a\nb\r\nc")).toBe("\n");
  });

  it("单处 CRLF：判 CRLF", () => {
    expect(detectEol("a\r\nb")).toBe("\r\n");
  });

  it("CRLF 计数多于 LF：判 CRLF", () => {
    expect(detectEol("a\r\nb\r\nc\nd")).toBe("\r\n");
  });

  it("仅一个 CRLF、无其他换行：判 CRLF", () => {
    expect(detectEol("\r\n")).toBe("\r\n");
  });
});
