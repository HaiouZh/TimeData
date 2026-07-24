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

  it("无活跃场且有可续场：每场一行「还有 N 条未完」+ 续场按钮，点击调 onResume(sessionId)", async () => {
    const onResume = vi.fn();
    const resumable: ResumableSession[] = [
      { session: session({ id: "s-old", startedAt: "2026-07-20T08:00:00.000Z", endedAt: "2026-07-20T10:00:00.000Z" }), pendingCount: 3 },
    ];
    const { host, root } = await renderDom(
      <AtHandSection atHand={[]} session={null} resumable={resumable} {...handlers} onResume={onResume} />,
    );

    expect(host.textContent).toContain("还有 3 条未完");
    const resumeBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "续场");
    expect(resumeBtn).toBeTruthy();
    await click(resumeBtn);
    expect(onResume).toHaveBeenCalledWith("s-old");

    await unmount(root);
  });

  it("无活跃场且无可续场：整区隐藏（host.innerHTML 为空）", async () => {
    const { host, root } = await renderDom(
      <AtHandSection atHand={[]} session={null} resumable={[]} {...handlers} />,
    );

    expect(host.innerHTML).toBe("");

    await unmount(root);
  });
});
