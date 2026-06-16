// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { Checkbox } from "./Checkbox.js";

afterEach(() => vi.restoreAllMocks());

describe("Checkbox", () => {
  it("checked 反映到原生 input", async () => {
    const { host, root } = await renderDom(
      createElement(Checkbox, { checked: true, onChange: () => {}, ariaLabel: "勾" }),
    );
    const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input?.checked).toBe(true);
    expect(input?.getAttribute("aria-label")).toBe("勾");
    await unmount(root);
  });

  it("点击触发 onChange(!checked)", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(Checkbox, { checked: false, onChange, ariaLabel: "勾" }),
    );
    await click(host.querySelector('input[type="checkbox"]'));
    expect(onChange).toHaveBeenCalledWith(true);
    await unmount(root);
  });
});
