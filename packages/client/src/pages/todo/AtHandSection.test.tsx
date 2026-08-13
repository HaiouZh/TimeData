// @vitest-environment jsdom

import { DndContext } from "@dnd-kit/core";
import type { Session, Task } from "@timedata/shared";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addTask, createChildTask } from "../../lib/tasks.js";
import type { ResumableSession } from "../../lib/sessions.js";
import { resetDb } from "../../test/dbReset.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { AtHandSection } from "./AtHandSection.js";

const renderSection = (node: ReactElement) => renderDom(<DndContext>{node}</DndContext>);

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t1",
    parentId: null,
    title: overrides.title ?? "手头任务",
    done: overrides.done ?? false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    weight: 0,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

function session(overrides: Partial<Session>): Session {
  return {
    id: overrides.id ?? "s1",
    startedAt: "2026-07-24T08:00:00.000Z",
    endedAt: null,
    note: null,
    createdAt: "2026-07-24T08:00:00.000Z",
    updatedAt: "2026-07-24T08:00:00.000Z",
    ...overrides,
  };
}

const handlers = {
  onRelease: vi.fn(),
  onEndSession: vi.fn(),
  onResume: vi.fn(),
  onToggle: vi.fn(),
  onEdit: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});
beforeEach(resetDb);

describe("AtHandSection", () => {
  it("活跃场：渲染未完任务标题、本场已完成折叠计数、散场按钮；点散场调 onEndSession", async () => {
    const onEndSession = vi.fn();
    const { host, root } = await renderSection(
      <AtHandSection
        atHand={[task({ id: "a", title: "买菜" }), task({ id: "b", title: "洗碗", done: true })]}
        session={session({})}
        resumable={[]}
        {...handlers}
        onEndSession={onEndSession}
      />,
    );

    expect(host.querySelector("h2")?.textContent).toBe("手头");
    expect(host.textContent).toContain("买菜");
    const collapsible = host.querySelector("details");
    expect(collapsible?.textContent).toContain("本场已完成");
    expect(collapsible?.textContent).toContain("1");
    expect(collapsible?.textContent).toContain("洗碗");

    const endBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "散场");
    expect(endBtn).toBeTruthy();
    await click(endBtn);
    expect(onEndSession).toHaveBeenCalledTimes(1);

    await unmount(root);
  });

  it("点行内「移出手头 <title>」按钮调 onRelease(task)", async () => {
    const onRelease = vi.fn();
    const target = task({ id: "a", title: "买菜" });
    const { host, root } = await renderSection(
      <AtHandSection atHand={[target]} session={session({})} resumable={[]} {...handlers} onRelease={onRelease} />,
    );

    const releaseBtn = host.querySelector('button[aria-label="移出手头 买菜"]');
    expect(releaseBtn).toBeTruthy();
    await click(releaseBtn);
    expect(onRelease).toHaveBeenCalledWith(target);

    await unmount(root);
  });

  it("无活跃场且有可续场：每场一行标题预览+「还有 N 条未完」+ 续场按钮，点击调 onResume(sessionId)", async () => {
    const onResume = vi.fn();
    const resumable: ResumableSession[] = [
      {
        session: session({ id: "s-old", startedAt: "2026-07-20T08:00:00.000Z", endedAt: "2026-07-20T10:00:00.000Z" }),
        pendingCount: 3,
        pendingTitles: ["修水管", "报销发票", "买菜"],
      },
    ];
    const { host, root } = await renderSection(
      <AtHandSection atHand={[]} session={null} resumable={resumable} {...handlers} onResume={onResume} />,
    );

    expect(host.querySelector("h2")?.textContent).toBe("手头");
    expect(host.textContent).toContain("修水管、报销发票、买菜");
    expect(host.textContent).toContain("还有 3 条未完");
    const resumeBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "续场");
    expect(resumeBtn).toBeTruthy();
    await click(resumeBtn);
    expect(onResume).toHaveBeenCalledWith("s-old");

    await unmount(root);
  });

  it("无活跃场且无可续场：整区隐藏（不渲染 section）", async () => {
    const { host, root } = await renderSection(<AtHandSection atHand={[]} session={null} resumable={[]} {...handlers} />);

    expect(host.querySelector('[data-section="todo-at-hand"]')).toBeNull();

    await unmount(root);
  });

  it("未完任务标题 Shift+单击：复制并上抛 onCopyTitle（透传 TaskRow）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopyTitle = vi.fn();
    const { host, root } = await renderDom(
      <AtHandSection
        atHand={[task({ id: "a", title: "买菜" })]}
        session={session({})}
        resumable={[]}
        {...handlers}
        onCopyTitle={onCopyTitle}
      />,
    );
    const { act } = await import("react");
    const title = host.querySelector(".select-text") as HTMLElement;
    expect(title?.textContent).toContain("买菜");
    await act(async () => {
      title.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    });
    expect(writeText).toHaveBeenCalledWith("买菜");
    expect(onCopyTitle).toHaveBeenCalledTimes(1);
    // biome-ignore lint/performance/noDelete: jsdom 的 navigator 跨测试文件共享，赋 undefined 会留下键、让被测代码的 clipboard 存在性判断走错分支（改成赋值曾让 TaskRow 用例翻红）
    delete (navigator as { clipboard?: unknown }).clipboard;
    await unmount(root);
  });
});

describe("场便签标题", () => {
  async function pressOnInput(input: HTMLInputElement, key: string): Promise<void> {
    const { act } = await import("react");
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  it("note 非空时标题显示 note,空时回落「手头」", async () => {
    const withNote = await renderSection(
      <AtHandSection atHand={[]} session={session({ note: "冲周报" })} resumable={[]} {...handlers} />,
    );
    expect(withNote.host.querySelector("h2")?.textContent).toBe("冲周报");
    await unmount(withNote.root);

    const withoutNote = await renderSection(
      <AtHandSection atHand={[]} session={session({})} resumable={[]} {...handlers} />,
    );
    expect(withoutNote.host.querySelector("h2")?.textContent).toBe("手头");
    await unmount(withoutNote.root);
  });

  it("点击标题进入编辑,Enter 保存调用 onUpdateNote 一次并退出编辑", async () => {
    const onUpdateNote = vi.fn();
    const { host, root } = await renderSection(
      <AtHandSection atHand={[]} session={session({})} resumable={[]} {...handlers} onUpdateNote={onUpdateNote} />,
    );

    await click(host.querySelector('button[aria-label="编辑场便签"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="场便签"]');
    expect(input).toBeTruthy();
    expect(input?.maxLength).toBe(200);

    input!.value = "下午先修 bug";
    await pressOnInput(input!, "Enter");

    expect(onUpdateNote).toHaveBeenCalledTimes(1);
    expect(onUpdateNote).toHaveBeenCalledWith("下午先修 bug");
    expect(host.querySelector('input[aria-label="场便签"]')).toBeNull();

    await unmount(root);
  });

  it("清空后 Enter 保存传 null", async () => {
    const onUpdateNote = vi.fn();
    const { host, root } = await renderSection(
      <AtHandSection
        atHand={[]}
        session={session({ note: "旧便签" })}
        resumable={[]}
        {...handlers}
        onUpdateNote={onUpdateNote}
      />,
    );

    await click(host.querySelector('button[aria-label="编辑场便签"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="场便签"]');
    input!.value = "";
    await pressOnInput(input!, "Enter");

    expect(onUpdateNote).toHaveBeenCalledWith(null);

    await unmount(root);
  });

  it("Escape 取消不调用 onUpdateNote", async () => {
    const onUpdateNote = vi.fn();
    const { host, root } = await renderSection(
      <AtHandSection atHand={[]} session={session({})} resumable={[]} {...handlers} onUpdateNote={onUpdateNote} />,
    );

    await click(host.querySelector('button[aria-label="编辑场便签"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="场便签"]');
    input!.value = "写了一半";
    await pressOnInput(input!, "Escape");

    expect(onUpdateNote).not.toHaveBeenCalled();
    expect(host.querySelector('input[aria-label="场便签"]')).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("手头");

    await unmount(root);
  });

  it("值未变时 Enter/失焦只退出编辑,不调用 onUpdateNote", async () => {
    const onUpdateNote = vi.fn();
    const { host, root } = await renderSection(
      <AtHandSection
        atHand={[]}
        session={session({ note: "冲周报" })}
        resumable={[]}
        {...handlers}
        onUpdateNote={onUpdateNote}
      />,
    );

    await click(host.querySelector('button[aria-label="编辑场便签"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="场便签"]');
    input!.value = "  冲周报  ";
    await pressOnInput(input!, "Enter");

    expect(onUpdateNote).not.toHaveBeenCalled();
    expect(host.querySelector('input[aria-label="场便签"]')).toBeNull();

    await unmount(root);
  });

  it("IME 组合态的 Enter 不保存不退出", async () => {
    const onUpdateNote = vi.fn();
    const { host, root } = await renderSection(
      <AtHandSection atHand={[]} session={session({})} resumable={[]} {...handlers} onUpdateNote={onUpdateNote} />,
    );

    await click(host.querySelector('button[aria-label="编辑场便签"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="场便签"]');
    input!.value = "chong";
    const { act } = await import("react");
    await act(async () => {
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }),
      );
    });

    expect(onUpdateNote).not.toHaveBeenCalled();
    expect(host.querySelector('input[aria-label="场便签"]')).toBeTruthy();

    await unmount(root);
  });

  it("note 为空串(外部数据)时标题回落「手头」", async () => {
    const { host, root } = await renderSection(
      <AtHandSection atHand={[]} session={session({ note: "  " })} resumable={[]} {...handlers} />,
    );
    expect(host.querySelector("h2")?.textContent).toBe("手头");
    await unmount(root);
  });

  it("活跃场切换时编辑态被重挂清空,旧场草稿不残留", async () => {
    const onUpdateNote = vi.fn();
    const props = { atHand: [], resumable: [], ...handlers, onUpdateNote };
    const { host, root } = await renderSection(
      <AtHandSection {...props} session={session({ id: "sA", note: "A 场便签" })} />,
    );

    await click(host.querySelector('button[aria-label="编辑场便签"]'));
    expect(host.querySelector('input[aria-label="场便签"]')).toBeTruthy();

    const { act } = await import("react");
    await act(async () => {
      root.render(<AtHandSection {...props} session={session({ id: "sB" })} />);
    });

    expect(host.querySelector('input[aria-label="场便签"]')).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("手头");
    expect(onUpdateNote).not.toHaveBeenCalled();

    await unmount(root);
  });

  it("续场列表态标题不可编辑", async () => {
    const resumable: ResumableSession[] = [
      {
        session: session({ id: "s-old", endedAt: "2026-07-20T10:00:00.000Z", note: "历史便签" }),
        pendingCount: 1,
        pendingTitles: ["修水管"],
      },
    ];
    const { host, root } = await renderSection(
      <AtHandSection atHand={[]} session={null} resumable={resumable} {...handlers} onUpdateNote={vi.fn()} />,
    );

    expect(host.querySelector('button[aria-label="编辑场便签"]')).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("手头");

    await unmount(root);
  });
});

describe("手头区拖拽排序", () => {
  it("活跃场未完行渲染拖柄，已完成行不渲染拖柄", async () => {
    const { host, root } = await renderSection(
      <AtHandSection
        atHand={[task({ id: "a", title: "买菜" }), task({ id: "b", title: "洗碗", done: true })]}
        session={session({})}
        resumable={[]}
        {...handlers}
      />,
    );

    const grabs = host.querySelectorAll('[data-testid="task-row-grab-area"]');
    expect(grabs.length).toBe(1);
    expect(grabs[0]?.getAttribute("aria-label")).toBe("移动 买菜");
    await unmount(root);
  });

  it("无活跃场（resumable 分支）不渲染拖柄", async () => {
    const resumable: ResumableSession[] = [
      {
        session: session({ id: "s-old", startedAt: "2026-07-20T08:00:00.000Z", endedAt: "2026-07-20T10:00:00.000Z" }),
        pendingCount: 1,
        pendingTitles: ["修水管"],
      },
    ];
    const { host, root } = await renderSection(
      <AtHandSection atHand={[]} session={null} resumable={resumable} {...handlers} />,
    );
    expect(host.querySelector('[data-testid="task-row-grab-area"]')).toBeNull();
    await unmount(root);
  });
});

describe("手头区父子收纳", () => {
  it("pendingTotal 传入时用它做标题计数", async () => {
    const { host, root } = await renderSection(
      <AtHandSection
        atHand={[task({ id: "a", title: "A" })]}
        session={session({})}
        resumable={[]}
        pendingTotal={3}
        {...handlers}
      />,
    );
    expect(host.textContent).toContain("3");
    await unmount(root);
  });

  it("indentTargetId 命中的行拿到缩进高亮环", async () => {
    const { host, root } = await renderSection(
      <AtHandSection
        atHand={[task({ id: "a", title: "A" }), task({ id: "b", title: "B" })]}
        session={session({})}
        resumable={[]}
        indentTargetId="a"
        {...handlers}
      />,
    );
    expect(host.querySelectorAll(".ring-accent")).toHaveLength(1);
    await unmount(root);
  });

  it("revealChildren 命中未完成行时展开该行的子任务面板（透传 TaskRow，A1）", async () => {
    const { host, root } = await renderSection(
      <AtHandSection
        atHand={[task({ id: "a", title: "A" }), task({ id: "b", title: "B" })]}
        session={session({})}
        resumable={[]}
        revealChildren={{ id: "a", nonce: 1 }}
        {...handlers}
      />,
    );
    // 命中行展开后（draggable 模式、0 子任务时 autoDraft 直开草稿行）渲染子任务创建输入框；
    // 未命中的 b 仍收着，不渲染。
    expect(host.querySelectorAll('[data-testid="child-create-draft-row"]')).toHaveLength(1);
    await unmount(root);
  });

  it("不传 revealChildren 或不命中任何行时不自动展开", async () => {
    const { host, root } = await renderSection(
      <AtHandSection atHand={[task({ id: "a", title: "A" })]} session={session({})} resumable={[]} {...handlers} />,
    );
    // 断言必须与正例同一个元素：`button[aria-label="添加子任务"]` 在展开与未展开两态下都是 null
    // ——未展开固然是 null，但误展开时 `autoDraft`（childTotal===0 恒真）会把它顶替成草稿行，
    // 也是 null，这条闸就形同虚设。改用正例用的 `child-create-draft-row` 才是真闸。
    expect(host.querySelector('[data-testid="child-create-draft-row"]')).toBeNull();
    await unmount(root);
  });
});

describe("手头区「本场已完成」子任务可操作性（A2）", () => {
  it("父任务已完成但子任务未完时，子任务渲染可勾选复选框，不再是只读快照", async () => {
    const parent = await addTask({ title: "已完成的父任务" });
    const child = await createChildTask(parent.id, "还没做完的子任务");
    const done = task({ id: parent.id, title: parent.title, done: true });

    const { host, root } = await renderSection(
      <AtHandSection atHand={[done]} session={session({})} resumable={[]} {...handlers} />,
    );

    // 「本场已完成」是原生 <details>，未展开时子节点仍在 DOM 里（只是视觉隐藏），
    // 不需要先点开 summary 就能拿到行节点。

    // 展开父行左 2/5 命中区，进入子任务层
    const row = host.querySelector('[aria-label^="打开"]') as HTMLElement;
    expect(row).toBeTruthy();
    row.getBoundingClientRect = () =>
      ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
    const { act } = await import("react");
    await act(async () => row.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 })));

    // InlineChildren 自己另开一份 useTaskChildren(parentId) liveQuery，与 TaskRow 那份不同实例，
    // 送达拍数不定：轮询等它真正把子任务查回来，而不是单拍 settle。
    let checkbox: Element | null = null;
    for (let i = 0; i < 20 && !checkbox; i += 1) {
      checkbox = host.querySelector(`input[aria-label="完成子任务 ${child.title}"]`);
      if (!checkbox) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }

    // readonly 模式下不会渲染这枚复选框（ReadonlyChildRow 无 Checkbox）；
    // 有它就证明 childrenModeOverride="static" 生效，子任务不再是永久只读。
    expect(checkbox).toBeTruthy();

    await unmount(root);
  });
});
