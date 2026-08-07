// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton.js";

afterEach(() => vi.restoreAllMocks());

describe("ConfirmDeleteButton", () => {
  it("首次点击只进入待确认态，不触发删除", async () => {
    const onConfirm = vi.fn();
    const { host, root } = await renderDom(createElement(ConfirmDeleteButton, { onConfirm, target: "步骤" }));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="删除步骤"]');
    expect(button).toBeInstanceOf(HTMLButtonElement);
    await click(button);
    expect(onConfirm).not.toHaveBeenCalled();
    // 待确认态：文案与 aria-label 同时变，屏幕阅读器用户才知道这一下是「确认」不是「删除」
    expect(host.querySelector('button[aria-label="确认删除步骤"]')?.textContent).toBe("确认删除");
    await unmount(root);
  });

  it("再点一次才真的删", async () => {
    const onConfirm = vi.fn();
    const { host, root } = await renderDom(createElement(ConfirmDeleteButton, { onConfirm, target: "步骤" }));
    await click(host.querySelector('button[aria-label="删除步骤"]'));
    await click(host.querySelector('button[aria-label="确认删除步骤"]'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("resetKey 变化把待确认态复位", async () => {
    const onConfirm = vi.fn();
    const { host, root } = await renderDom(
      createElement(ConfirmDeleteButton, { onConfirm, target: "步骤", resetKey: false }),
    );
    await click(host.querySelector('button[aria-label="删除步骤"]'));
    expect(host.querySelector('button[aria-label="确认删除步骤"]')).not.toBeNull();
    // 抽取前这条行为散在父组件里（编辑按钮 onClick 与 saveEdit 各一次 setConfirmingDelete(false)）：
    // 进编辑态时待确认必须撤销，否则用户编辑完回来手一抖就删了。
    // domHarness 没有 rerender——重渲染就是往同一个 root 再 render 一次，必须包 act。
    await act(async () => {
      root.render(createElement(ConfirmDeleteButton, { onConfirm, target: "步骤", resetKey: true }));
    });
    expect(host.querySelector('button[aria-label="删除步骤"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="确认删除步骤"]')).toBeNull();
    await unmount(root);
  });

  it("进入待确认态时 live region 播报提示，常态为空", async () => {
    const onConfirm = vi.fn();
    const { host, root } = await renderDom(createElement(ConfirmDeleteButton, { onConfirm, target: "步骤" }));
    const live = host.querySelector<HTMLSpanElement>("[aria-live='polite']");
    expect(live).toBeInstanceOf(HTMLSpanElement);
    expect(live?.textContent).toBe("");
    await click(host.querySelector('button[aria-label="删除步骤"]'));
    expect(host.querySelector<HTMLSpanElement>("[aria-live='polite']")?.textContent).toBe("再按一次确认删除步骤");
    await unmount(root);
  });

  it("确认在途期间再次点击不会重复触发 onConfirm", async () => {
    let resolveConfirm: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const { host, root } = await renderDom(createElement(ConfirmDeleteButton, { onConfirm, target: "步骤" }));
    await click(host.querySelector('button[aria-label="删除步骤"]'));
    await click(host.querySelector('button[aria-label="确认删除步骤"]'));
    await click(host.querySelector('button[aria-label="确认删除步骤"]'));
    await click(host.querySelector('button[aria-label="确认删除步骤"]'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => resolveConfirm?.());
    await unmount(root);
  });

  it("onConfirm reject 后按钮退回常态、不卡死", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("boom"));
    const { host, root } = await renderDom(createElement(ConfirmDeleteButton, { onConfirm, target: "步骤" }));
    await click(host.querySelector('button[aria-label="删除步骤"]'));
    await click(host.querySelector('button[aria-label="确认删除步骤"]'));
    await act(async () => {});
    expect(host.querySelector('button[aria-label="确认删除步骤"]')).toBeNull();
    expect(host.querySelector('button[aria-label="删除步骤"]')).not.toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await unmount(root);
  });
});
