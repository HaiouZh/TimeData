// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { LoadingState } from "./LoadingState.js";

afterEach(() => vi.restoreAllMocks());

describe("LoadingState", () => {
  it("默认 label 正在加载…", async () => {
    const { host, root } = await renderDom(createElement(LoadingState, {}));
    expect(host.textContent).toBe("正在加载…");
    await unmount(root);
  });

  it("渲染传入 label", async () => {
    const { host, root } = await renderDom(createElement(LoadingState, { label: "正在读取速记..." }));
    expect(host.textContent).toBe("正在读取速记...");
    await unmount(root);
  });

  it("className 透传", async () => {
    const { host, root } = await renderDom(createElement(LoadingState, { className: "min-h-full bg-page px-4 py-6" }));
    const el = host.querySelector("div");
    expect(el?.className).toContain("min-h-full");
    expect(el?.className).toContain("bg-page");
    expect(el?.className).toContain("px-4");
    expect(el?.className).toContain("py-6");
    await unmount(root);
  });
});
