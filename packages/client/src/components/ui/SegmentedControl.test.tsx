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

  it("size 档：lg 用大热区与 body 字号，sm 用紧凑档（非等宽）", async () => {
    const lg = await renderDom(
      createElement(SegmentedControl, { options: opts, value: "a", onChange: () => {}, ariaLabel: "t", size: "lg" }),
    );
    expect(lg.host.querySelector('[role="radio"]')?.className).toContain("min-h-11");
    expect(lg.host.querySelector('[role="radio"]')?.className).toContain("td-text-body");
    await unmount(lg.root);

    const sm = await renderDom(
      createElement(SegmentedControl, { options: opts, value: "a", onChange: () => {}, ariaLabel: "t", size: "sm" }),
    );
    expect(sm.host.querySelector('[role="radio"]')?.className).toContain("min-h-9");
    expect(sm.host.querySelector('[role="radio"]')?.className).toContain("td-text-caption");
    expect(sm.host.querySelector('[role="radio"]')?.className).not.toContain("flex-1");
    await unmount(sm.root);
  });
});
