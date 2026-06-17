// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SubtaskRow } from "./SubtaskRow.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  subtask: { id: "a", title: "甲", done: false },
  registerRef: () => {},
  onToggle: () => {},
  onTitleChange: () => {},
  onEnter: () => {},
  onBackspaceEmpty: () => {},
};

async function render(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

describe("SubtaskRow", () => {
  it("用 textarea 渲染标题，可换行且无 truncate/border", async () => {
    const { host, root } = await render(createElement(SubtaskRow, base));
    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;

    expect(field).not.toBeNull();
    expect(field.value).toBe("甲");
    expect(field.className).not.toContain("truncate");
    expect(field.className).not.toContain("border");

    await act(async () => root.unmount());
    host.remove();
  });

  it("回车（无 shift）触发 onEnter，不插入换行", async () => {
    const onEnter = vi.fn();
    const { host, root } = await render(createElement(SubtaskRow, { ...base, onEnter }));
    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });

    await act(async () => field.dispatchEvent(event));

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    await act(async () => root.unmount());
    host.remove();
  });

  it("Shift+回车保留 textarea 默认换行行为", async () => {
    const onEnter = vi.fn();
    const { host, root } = await render(createElement(SubtaskRow, { ...base, onEnter }));
    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });

    await act(async () => field.dispatchEvent(event));

    expect(onEnter).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    await act(async () => root.unmount());
    host.remove();
  });

  it("空内容退格触发 onBackspaceEmpty", async () => {
    const onBackspaceEmpty = vi.fn();
    const { host, root } = await render(
      createElement(SubtaskRow, { ...base, subtask: { id: "a", title: "", done: false }, onBackspaceEmpty }),
    );
    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;

    await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));

    expect(onBackspaceEmpty).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
  });

  it("已完成子任务标题加删除线", async () => {
    const { host, root } = await render(
      createElement(SubtaskRow, { ...base, subtask: { id: "a", title: "甲", done: true } }),
    );
    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;

    expect(field.className).toContain("line-through");
    await act(async () => root.unmount());
    host.remove();
  });
});
