// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { StatusBanner } from "./StatusBanner.js";

afterEach(() => vi.restoreAllMocks());

describe("StatusBanner", () => {
  it("info tone 类名", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "info" }, "提示"));
    const el = host.querySelector("div");
    expect(el?.className).toContain("rounded-card");
    expect(el?.className).toContain("border-border");
    expect(el?.className).toContain("bg-surface/95");
    expect(el?.className).toContain("text-ink-2");
    await unmount(root);
  });

  it("warn tone 类名", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "warn" }, "警告"));
    const el = host.querySelector("div");
    expect(el?.className).toContain("border-warn/40");
    expect(el?.className).toContain("bg-warn/10");
    expect(el?.className).toContain("text-warn");
    await unmount(root);
  });

  it("danger tone 类名", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "danger" }, "错误"));
    const el = host.querySelector("div");
    expect(el?.className).toContain("border-danger/40");
    expect(el?.className).toContain("bg-danger/10");
    expect(el?.className).toContain("text-danger");
    await unmount(root);
  });

  it("children 渲染", async () => {
    const { host, root } = await renderDom(createElement(StatusBanner, { tone: "info" }, "同步失败"));
    expect(host.textContent).toContain("同步失败");
    await unmount(root);
  });
});
