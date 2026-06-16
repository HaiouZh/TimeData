// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { SegmentedControl } from "./SegmentedControl.js";

afterEach(() => vi.restoreAllMocks());

const opts = [
  { value: "a", label: "甲" },
  { value: "b", label: "乙" },
  { value: "c", label: "丙", disabled: true },
];

describe("SegmentedControl", () => {
  it("渲染 radiogroup，选中段 aria-checked=true", async () => {
    const { host, root } = await renderDom(
      createElement(SegmentedControl, { options: opts, value: "b", onChange: () => {}, ariaLabel: "测试" }),
    );
    expect(host.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("测试");
    const radios = [...host.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    await unmount(root);
  });

  it("点未选段触发 onChange(value)", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(SegmentedControl, { options: opts, value: "a", onChange, ariaLabel: "t" }),
    );
    await click(host.querySelectorAll('[role="radio"]')[1]);
    expect(onChange).toHaveBeenCalledWith("b");
    await unmount(root);
  });

  it("disabled 段不触发 onChange", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(SegmentedControl, { options: opts, value: "a", onChange, ariaLabel: "t" }),
    );
    await click(host.querySelectorAll('[role="radio"]')[2]);
    expect(onChange).not.toHaveBeenCalled();
    await unmount(root);
  });
});
