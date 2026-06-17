// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TaskSubtask } from "@timedata/shared";
import { SubtaskEditor } from "./SubtaskEditor.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subs: TaskSubtask[] = [
  { id: "a", title: "一", done: false },
  { id: "b", title: "二", done: false },
];

async function render(value: TaskSubtask[], onChange = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(SubtaskEditor, { value, onChange, genId: () => "new" }));
  });
  return { host, root, onChange };
}

describe("SubtaskEditor 拖拽与手感", () => {
  it("每个子任务渲染一个拖柄", async () => {
    const { host, root } = await render(subs);
    const handles = host.querySelectorAll('[aria-label^="拖动子任务"]');
    expect(handles.length).toBe(2);
    await act(async () => root.unmount());
  });

  it("回车在当前行后插入新子任务", async () => {
    const { host, root, onChange } = await render(subs);
    const input = host.querySelectorAll('textarea[aria-label="子任务标题"]')[0] as HTMLTextAreaElement;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith([
      { id: "a", title: "一", done: false },
      { id: "new", title: "", done: false },
      { id: "b", title: "二", done: false },
    ]);
    await act(async () => root.unmount());
  });

  it("子任务标题输入无边框且不截断长文本", async () => {
    const { host, root } = await render([{ id: "a", title: "一段很长很长的子任务标题", done: false }]);
    const field = host.querySelector('textarea[aria-label="子任务标题"]') as HTMLTextAreaElement;
    expect(field.className).not.toContain("border");
    expect(field.className).not.toContain("truncate");
    await act(async () => root.unmount());
  });

  it("compact 密度：无拖柄、显示轻量添加按钮", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        createElement(SubtaskEditor, { value: subs, onChange: vi.fn(), genId: () => "new", density: "compact" }),
      );
    });

    expect(host.querySelectorAll('[aria-label^="拖动子任务"]').length).toBe(0);
    expect(host.textContent).toContain("+ 子任务");
    expect(host.textContent).not.toContain("+ 添加子任务");

    await act(async () => root.unmount());
    host.remove();
  });

  it("autoFocusId 聚焦对应子任务输入框", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        createElement(SubtaskEditor, {
          value: subs,
          onChange: vi.fn(),
          genId: () => "new",
          density: "compact",
          autoFocusId: "b",
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const fields = host.querySelectorAll('textarea[aria-label="子任务标题"]');
    expect(document.activeElement).toBe(fields[1]);

    await act(async () => root.unmount());
    host.remove();
  });
});
