// @vitest-environment jsdom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
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
});
