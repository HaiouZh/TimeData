// @vitest-environment jsdom

import type { Session, Task } from "@timedata/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumableSession } from "../../lib/sessions.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { AtHandSection } from "./AtHandSection.js";

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

describe("AtHandSection", () => {
  it("活跃场：渲染未完任务标题、本场已完成折叠计数、散场按钮；点散场调 onEndSession", async () => {
    const onEndSession = vi.fn();
    const { host, root } = await renderDom(
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
    const { host, root } = await renderDom(
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
    const { host, root } = await renderDom(
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

  it("无活跃场且无可续场：整区隐藏（host.innerHTML 为空）", async () => {
    const { host, root } = await renderDom(<AtHandSection atHand={[]} session={null} resumable={[]} {...handlers} />);

    expect(host.innerHTML).toBe("");

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
    const withNote = await renderDom(
      <AtHandSection atHand={[]} session={session({ note: "冲周报" })} resumable={[]} {...handlers} />,
    );
    expect(withNote.host.querySelector("h2")?.textContent).toBe("冲周报");
    await unmount(withNote.root);

    const withoutNote = await renderDom(
      <AtHandSection atHand={[]} session={session({})} resumable={[]} {...handlers} />,
    );
    expect(withoutNote.host.querySelector("h2")?.textContent).toBe("手头");
    await unmount(withoutNote.root);
  });

  it("点击标题进入编辑,Enter 保存调用 onUpdateNote 一次并退出编辑", async () => {
    const onUpdateNote = vi.fn();
    const { host, root } = await renderDom(
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
    const { host, root } = await renderDom(
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
    const { host, root } = await renderDom(
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
    const { host, root } = await renderDom(
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
    const { host, root } = await renderDom(
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
    const { host, root } = await renderDom(
      <AtHandSection atHand={[]} session={session({ note: "  " })} resumable={[]} {...handlers} />,
    );
    expect(host.querySelector("h2")?.textContent).toBe("手头");
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
    const { host, root } = await renderDom(
      <AtHandSection atHand={[]} session={null} resumable={resumable} {...handlers} onUpdateNote={vi.fn()} />,
    );

    expect(host.querySelector('button[aria-label="编辑场便签"]')).toBeNull();
    expect(host.querySelector("h2")?.textContent).toBe("手头");

    await unmount(root);
  });
});
