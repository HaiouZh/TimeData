// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { EmptyState } from "./EmptyState.js";

afterEach(() => vi.restoreAllMocks());

describe("EmptyState", () => {
  it("渲染 title", async () => {
    const { host, root } = await renderDom(createElement(EmptyState, { title: "今天还没有记录" }));
    expect(host.textContent).toContain("今天还没有记录");
    await unmount(root);
  });

  it("card（默认）带卡片容器类", async () => {
    const { host, root } = await renderDom(createElement(EmptyState, { title: "空" }));
    const el = host.querySelector("div");
    expect(el?.className).toContain("rounded-card");
    expect(el?.className).toContain("bg-surface");
    expect(el?.className).toContain("text-center");
    await unmount(root);
  });

  it("inline 无卡片容器类", async () => {
    const { host, root } = await renderDom(createElement(EmptyState, { title: "空", variant: "inline" }));
    const el = host.querySelector("div");
    expect(el?.className).toContain("td-text-body");
    expect(el?.className).not.toContain("rounded-card");
    expect(el?.className).not.toContain("bg-surface");
    await unmount(root);
  });

  it("icon 渲染", async () => {
    const { host, root } = await renderDom(
      createElement(EmptyState, { title: "空", icon: createElement("span", { "data-testid": "icon" }) }),
    );
    expect(host.querySelector('[data-testid="icon"]')).not.toBeNull();
    await unmount(root);
  });

  it("description 与 action 渲染", async () => {
    const { host, root } = await renderDom(
      createElement(EmptyState, {
        title: "还没有速记",
        description: "写下一个想法、线索或待办，稍后再回来看。",
        action: createElement("button", { type: "button" }, "去写"),
      }),
    );
    expect(host.textContent).toContain("写下一个想法、线索或待办，稍后再回来看。");
    expect(host.querySelector("button")?.textContent).toBe("去写");
    await unmount(root);
  });

  it("inline 变体也渲染 description 与 action", async () => {
    const { host, root } = await renderDom(
      createElement(EmptyState, {
        title: "今天还没有记录",
        description: "先记一条时间",
        action: createElement("button", { type: "button" }, "去记录"),
        variant: "inline",
      }),
    );
    expect(host.textContent).toContain("先记一条时间");
    expect(host.querySelector("button")?.textContent).toBe("去记录");
    await unmount(root);
  });

  it("文案不含 emoji", async () => {
    const { host, root } = await renderDom(
      createElement(EmptyState, { title: "今天没有任务", description: "写下一个想法" }),
    );
    expect(host.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    await unmount(root);
  });
});
