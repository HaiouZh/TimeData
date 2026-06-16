// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { Switch } from "./Switch.js";

afterEach(() => vi.restoreAllMocks());

describe("Switch", () => {
  it("role=switch + aria-checked 反映状态", async () => {
    const { host, root } = await renderDom(
      createElement(Switch, { checked: true, onChange: () => {}, ariaLabel: "开关" }),
    );
    const sw = host.querySelector('[role="switch"]');
    expect(sw?.getAttribute("aria-checked")).toBe("true");
    expect(sw?.getAttribute("aria-label")).toBe("开关");
    await unmount(root);
  });

  it("点击触发 onChange(!checked)", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(Switch, { checked: false, onChange, ariaLabel: "开关" }),
    );
    await click(host.querySelector('[role="switch"]'));
    expect(onChange).toHaveBeenCalledWith(true);
    await unmount(root);
  });
});
