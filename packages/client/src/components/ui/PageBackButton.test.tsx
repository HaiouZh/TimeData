// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { PageBackButton } from "./PageBackButton.js";

afterEach(() => vi.restoreAllMocks());

describe("PageBackButton", () => {
  it("不传 to 渲染 button，aria-label 默认「返回」", async () => {
    const { host, root } = await renderDom(createElement(PageBackButton));
    const btn = host.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-label")).toBe("返回");
    await unmount(root);
  });

  it("传 label 则 aria-label 用传入值", async () => {
    const { host, root } = await renderDom(createElement(PageBackButton, { label: "返回设置" }));
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("返回设置");
    await unmount(root);
  });

  it("传 to 渲染 Link（<a>），href 指向 to", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, null, createElement(PageBackButton, { to: "/settings" })),
    );
    const link = host.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/settings");
    await unmount(root);
  });

  it("onClick 时点击触发回调", async () => {
    const onClick = vi.fn();
    const { host, root } = await renderDom(createElement(PageBackButton, { onClick }));
    await click(host.querySelector("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});
