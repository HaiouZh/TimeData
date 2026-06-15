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
    const input = host.querySelectorAll('input[aria-label="子任务标题"]')[0] as HTMLInputElement;
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
});
