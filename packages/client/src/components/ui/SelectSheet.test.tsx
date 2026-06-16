// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { SelectSheet } from "./SelectSheet.js";

afterEach(() => vi.restoreAllMocks());

const opts = [
  { value: "x", label: "选项X" },
  { value: "y", label: "选项Y" },
];

describe("SelectSheet", () => {
  it("触发器显当前值；无值显 placeholder", async () => {
    const a = await renderDom(
      createElement(SelectSheet, { options: opts, value: "y", onChange: () => {}, label: "标签" }),
    );
    expect(a.host.querySelector("button")?.textContent).toContain("选项Y");
    await unmount(a.root);

    const b = await renderDom(
      createElement(SelectSheet, { options: opts, value: null, onChange: () => {}, label: "标签", placeholder: "未指定" }),
    );
    expect(b.host.querySelector("button")?.textContent).toContain("未指定");
    await unmount(b.root);
  });

  it("点触发器开 sheet，点选项回调并关闭", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(SelectSheet, { options: opts, value: "x", onChange, label: "标签" }),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click(host.querySelector("button")); // 触发器
    const optionBtn = [...host.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes("选项Y"));
    await click(optionBtn);
    expect(onChange).toHaveBeenCalledWith("y");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });

  it("空列表显空状态", async () => {
    const { host, root } = await renderDom(
      createElement(SelectSheet, { options: [], value: null, onChange: () => {}, label: "标签", placeholder: "未指定" }),
    );
    await click(host.querySelector("button"));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("暂无选项");
    await unmount(root);
  });
});
