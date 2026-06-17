// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CollapsibleSection } from "./CollapsibleSection.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CollapsibleSection", () => {
  it("toggle 时回调当前 open 状态", async () => {
    const onToggle = vi.fn();
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () =>
      root.render(
        createElement(
          CollapsibleSection,
          { title: "完成", count: 1, defaultOpen: true, onToggle },
          createElement("p", null, "内容"),
        ),
      ),
    );
    const details = host.querySelector("details") as HTMLDetailsElement;

    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(onToggle).toHaveBeenCalledWith(false);

    await act(async () => root.unmount());
  });

  it("defaultOpen 只作为初始值，父级重渲染不覆盖用户切换", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    const render = () =>
      root.render(
        createElement(
          CollapsibleSection,
          { title: "完成", count: 1, defaultOpen: false },
          createElement("p", null, "内容"),
        ),
      );

    await act(async () => render());
    const details = host.querySelector("details") as HTMLDetailsElement;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    await act(async () => render());

    expect(details.open).toBe(true);

    await act(async () => root.unmount());
  });
});
