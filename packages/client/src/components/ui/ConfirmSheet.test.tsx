// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, pressKey, renderDom, unmount } from "../../test/domHarness.js";
import { ConfirmSheet } from "./ConfirmSheet.js";

afterEach(() => vi.restoreAllMocks());

function props(over: Partial<Parameters<typeof ConfirmSheet>[0]> = {}) {
  return { open: true, title: "确认删除？", body: "不可恢复", onConfirm: () => {}, onCancel: () => {}, ...over };
}

describe("ConfirmSheet", () => {
  it("open=false 不渲染", async () => {
    const { host, root } = await renderDom(createElement(ConfirmSheet, props({ open: false })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });

  it("确认按钮触发 onConfirm", async () => {
    const onConfirm = vi.fn();
    const { host, root } = await renderDom(createElement(ConfirmSheet, props({ onConfirm, confirmLabel: "删除" })));
    const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === "删除");
    await click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("Esc 触发 onCancel", async () => {
    const onCancel = vi.fn();
    const { root } = await renderDom(createElement(ConfirmSheet, props({ onCancel })));
    await pressKey("Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});
