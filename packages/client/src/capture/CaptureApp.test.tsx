// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderDom } from "../test/domHarness.js";
import { CaptureApp } from "./CaptureApp.js";

describe("CaptureApp 骨架", () => {
  it("渲染一个自动聚焦的输入框", async () => {
    const { host } = await renderDom(createElement(CaptureApp));
    const input = host.querySelector("textarea");
    expect(input).not.toBeNull();
    expect(input?.getAttribute("aria-label")).toBe("速记浮窗输入框");
    expect(document.activeElement).toBe(input);
  });

  it("不渲染打点反馈层——浮窗挂第二个热键桥会让一次打点落两条记录", async () => {
    const { host } = await renderDom(createElement(CaptureApp));
    expect(host.querySelector('[data-testid="desktop-punch-layer"]')).toBeNull();
  });
});
