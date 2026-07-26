// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { CollapsibleSection } from "./CollapsibleSection.js";

describe("CollapsibleSection", () => {
  it("toggle 时回调当前 open 状态", async () => {
    const onToggle = vi.fn();
    const { host, root } = await renderDom(
      createElement(
        CollapsibleSection,
        { title: "完成", count: 1, defaultOpen: true, onToggle },
        createElement("p", null, "内容"),
      ),
    );
    const details = host.querySelector("details") as HTMLDetailsElement;

    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(onToggle).toHaveBeenCalledWith(false);

    await unmount(root);
  });

  it("defaultOpen 只作为初始值，父级重渲染不覆盖用户切换", async () => {
    const node = createElement(
      CollapsibleSection,
      { title: "完成", count: 1, defaultOpen: false },
      createElement("p", null, "内容"),
    );
    const { host, root } = await renderDom(node);

    const details = host.querySelector("details") as HTMLDetailsElement;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    await act(async () => root.render(node));

    expect(details.open).toBe(true);

    await unmount(root);
  });

  it("点 summary 本体会展开（探针：确认 jsdom 实现了 details 默认行为）", async () => {
    const { host, root } = await renderDom(
      createElement(CollapsibleSection, { title: "收件箱", count: 3 }, createElement("p", null, "内容")),
    );
    const details = host.querySelector("details") as HTMLDetailsElement;
    const summary = host.querySelector("summary") as HTMLElement;
    expect(details.open).toBe(false);

    await click(summary);

    // 这条本身不测新功能，它测的是**下一条用例有没有承重**：若 jsdom 不实现 summary 的
    // 折叠默认行为，下面那条「点 action 不折叠」就会无论实现对错都绿。
    expect(details.open).toBe(true);
    await unmount(root);
  });

  it("action 插槽渲染在标题右侧，点它触发回调且不折叠区块", async () => {
    const onAction = vi.fn();
    const { host, root } = await renderDom(
      createElement(
        CollapsibleSection,
        {
          title: "收件箱",
          count: 3,
          action: createElement("button", { type: "button", "aria-label": "圈成项目", onClick: onAction }, "圈成项目"),
        },
        createElement("p", null, "内容"),
      ),
    );
    const details = host.querySelector("details") as HTMLDetailsElement;
    const button = host.querySelector('[aria-label="圈成项目"]') as HTMLElement;
    expect(details.open).toBe(false);

    await click(button);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(details.open).toBe(false);
    await unmount(root);
  });

  it("action 里放非按钮元素时，包裹层挡住 summary 的默认折叠（preventDefault 的真闸）", async () => {
    // 上一条用例在 jsdom 里**不承重**，这条才是 preventDefault 的守卫，原因：
    //
    // jsdom 严格照 DOM 规范挑 activation target——取事件路径上**最内层**带 activation behavior
    // 的元素。`<button>` 自己带（提交/重置），于是它抢走 activation target，`<summary>` 的折叠
    // 默认行为在 jsdom 里根本不会跑。实测：按钮 action 即使**完全不挂 onClick**，details 也不展开。
    // 真实浏览器（Blink）走的是 DefaultEventHandler 逐级上溯，type=button 不吃掉事件，summary
    // 照常折叠——这正是生产代码需要 preventDefault 的原因，只是 jsdom 见证不到那条路径。
    //
    // 换成不带 activation behavior 的元素（span），jsdom 就会让 summary 的默认行为跑起来，
    // 从而能真正验证包裹层的拦截。变异确认：删掉 preventDefault 或换成 stopPropagation，本条转红。
    const onAction = vi.fn();
    const { host, root } = await renderDom(
      createElement(
        CollapsibleSection,
        {
          title: "收件箱",
          count: 3,
          action: createElement("span", { role: "button", "aria-label": "圈成项目", onClick: onAction }, "圈成项目"),
        },
        createElement("p", null, "内容"),
      ),
    );
    const details = host.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);

    await click(host.querySelector('[aria-label="圈成项目"]'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(details.open).toBe(false);
    await unmount(root);
  });

  it("不传 action 时 summary 内不多出包裹节点", async () => {
    const { host, root } = await renderDom(
      createElement(CollapsibleSection, { title: "收件箱", count: 3 }, createElement("p", null, "内容")),
    );
    expect(host.querySelector("[data-section-action]")).toBeNull();
    await unmount(root);
  });
});
