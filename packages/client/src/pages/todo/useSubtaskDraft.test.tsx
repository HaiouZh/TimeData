// @vitest-environment jsdom
import type { TaskSubtask } from "@timedata/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useSubtaskDraft } from "./useSubtaskDraft.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const one: TaskSubtask[] = [{ id: "a", title: "甲", done: false }];

function Harness(props: { taskId: string; external: TaskSubtask[]; onCommit: (next: TaskSubtask[]) => void }) {
  const { subtasks, onChange, onBlur } = useSubtaskDraft({
    taskId: props.taskId,
    externalSubtasks: props.external,
    onCommit: props.onCommit,
  });
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "count" }, String(subtasks.length)),
    createElement("span", { "data-testid": "first" }, subtasks[0]?.title ?? ""),
    createElement("button", {
      "data-testid": "toggle",
      onClick: () => onChange(subtasks.map((s, index) => (index === 0 ? { ...s, done: !s.done } : s))),
    }),
    createElement("button", {
      "data-testid": "edit",
      onClick: () => onChange(subtasks.map((s, index) => (index === 0 ? { ...s, title: `${s.title}!` } : s))),
    }),
    createElement("button", { "data-testid": "blur", onClick: () => onBlur() }),
  );
}

async function mount(props: Parameters<typeof Harness>[0]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(Harness, props)));
  return { host, root };
}

describe("useSubtaskDraft", () => {
  it("按 taskId 初始化 draft", async () => {
    const onCommit = vi.fn();
    const { host, root } = await mount({ taskId: "t1", external: one, onCommit });

    expect(host.querySelector('[data-testid="count"]')?.textContent).toBe("1");
    expect(host.querySelector('[data-testid="first"]')?.textContent).toBe("甲");

    await act(async () => root.unmount());
    host.remove();
  });

  it("结构性变更（勾选）即时提交", async () => {
    const onCommit = vi.fn();
    const { host, root } = await mount({ taskId: "t1", external: one, onCommit });

    await act(async () =>
      host.querySelector('[data-testid="toggle"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(onCommit).toHaveBeenCalledWith([{ id: "a", title: "甲", done: true }]);
    await act(async () => root.unmount());
    host.remove();
  });

  it("纯文字变更不即时提交，blur 才提交并 trim", async () => {
    const onCommit = vi.fn();
    const { host, root } = await mount({
      taskId: "t1",
      external: [{ id: "a", title: "甲 ", done: false }],
      onCommit,
    });

    await act(async () =>
      host.querySelector('[data-testid="edit"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () =>
      host.querySelector('[data-testid="blur"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(onCommit).toHaveBeenCalledWith([{ id: "a", title: "甲 !", done: false }]);
    await act(async () => root.unmount());
    host.remove();
  });

  it("卸载时 flush 未提交的文字改动", async () => {
    const onCommit = vi.fn();
    const { host, root } = await mount({ taskId: "t1", external: one, onCommit });

    await act(async () =>
      host.querySelector('[data-testid="edit"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onCommit).not.toHaveBeenCalled();

    await act(async () => root.unmount());

    expect(onCommit).toHaveBeenCalledWith([{ id: "a", title: "甲!", done: false }]);
    host.remove();
  });

  it("挂载期内外部刷新（同 taskId）不覆盖 draft", async () => {
    const onCommit = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(createElement(Harness, { taskId: "t1", external: one, onCommit })));
    await act(async () =>
      host.querySelector('[data-testid="edit"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await act(async () =>
      root.render(
        createElement(Harness, {
          taskId: "t1",
          external: [{ id: "a", title: "远端", done: false }],
          onCommit,
        }),
      ),
    );

    expect(host.querySelector('[data-testid="first"]')?.textContent).toBe("甲!");
    await act(async () => root.unmount());
    host.remove();
  });

  it("taskId 变化时 flush 旧 draft 并重新播种", async () => {
    const onCommit = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(createElement(Harness, { taskId: "t1", external: one, onCommit })));
    await act(async () =>
      host.querySelector('[data-testid="edit"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await act(async () =>
      root.render(
        createElement(Harness, {
          taskId: "t2",
          external: [{ id: "b", title: "乙", done: false }],
          onCommit,
        }),
      ),
    );

    expect(onCommit).toHaveBeenCalledWith([{ id: "a", title: "甲!", done: false }]);
    expect(host.querySelector('[data-testid="first"]')?.textContent).toBe("乙");
    await act(async () => root.unmount());
    host.remove();
  });
});
