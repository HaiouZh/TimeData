// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalMemberRef, Task, Track } from "@timedata/shared";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalAddMemberSheet, type GoalAddMemberSheetProps } from "./GoalAddMemberSheet.js";

const now = "2026-06-23T08:00:00.000Z";

function task(input: Pick<Task, "id" | "title">): Task {
  return {
    id: input.id,
    parentId: null,
    title: input.title,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function track(input: Pick<Track, "id" | "title">): Track {
  return {
    id: input.id,
    title: input.title,
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
  };
}

const taskA = task({ id: "task-a", title: "写发布文案" });
const taskB = task({ id: "task-b", title: "已加入任务" });
const trackA = track({ id: "track-a", title: "发布轨道" });
const trackB = track({ id: "track-b", title: "已加入轨道" });

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function renderSheet(overrides: Partial<GoalAddMemberSheetProps> = {}) {
  const props: GoalAddMemberSheetProps = {
    open: true,
    tasks: [taskA, taskB],
    tracks: [trackA, trackB],
    steps: [],
    members: [],
    boardSignals: ["待我处理", "agent在做"],
    archived: false,
    onAddMember: vi.fn<(ref: GoalMemberRef) => void>(),
    onQuickCreateTask: vi.fn<(title: string) => void>(),
    onClose: vi.fn(),
    ...overrides,
  };

  return renderDom(createElement(GoalAddMemberSheet, props));
}

function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const button = root.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${label}`);
  return button;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button text: ${text}`);
  return button;
}

async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GoalAddMemberSheet", () => {
  it("open=false 时不渲染 sheet 内容", async () => {
    mounted = await renderSheet({ open: false });

    expect(mounted.host.querySelector('[role="dialog"]')).toBeNull();
    expect(mounted.host.querySelector('input[aria-label="新建任务并加入"]')).toBeNull();
  });

  it("picker 只列未加入 Goal 的任务和轨道", async () => {
    mounted = await renderSheet({
      members: [
        { kind: "task", id: "task-b" },
        { kind: "track", id: "track-b" },
      ],
    });

    expect(mounted.host.textContent).toContain("写发布文案");
    expect(mounted.host.textContent).not.toContain("已加入任务");

    await click(buttonByText(mounted.host, "轨道"));
    expect(mounted.host.textContent).toContain("发布轨道");
    expect(mounted.host.textContent).not.toContain("已加入轨道");
  });

  it("选择任务或轨道时以 GoalMemberRef 调用 onAddMember", async () => {
    const onAddMember = vi.fn<(ref: GoalMemberRef) => void>();
    mounted = await renderSheet({ onAddMember });

    await click(buttonByLabel(mounted.host, "添加任务 写发布文案"));
    expect(onAddMember).toHaveBeenCalledWith({ kind: "task", id: "task-a" });

    await click(buttonByText(mounted.host, "轨道"));
    await click(buttonByLabel(mounted.host, "添加轨道 发布轨道"));
    expect(onAddMember).toHaveBeenCalledWith({ kind: "track", id: "track-a" });
  });

  it("快建任务提交 trim 后标题，空标题不调用", async () => {
    const onQuickCreateTask = vi.fn<(title: string) => void>();
    mounted = await renderSheet({ onQuickCreateTask });
    const input = mounted.host.querySelector('input[aria-label="新建任务并加入"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing quick create input");

    await typeInput(input, "  补发布检查  ");
    await click(buttonByText(mounted.host, "加入"));
    expect(onQuickCreateTask).toHaveBeenCalledWith("补发布检查");

    onQuickCreateTask.mockClear();
    await typeInput(input, "   ");
    await click(buttonByText(mounted.host, "加入"));
    expect(onQuickCreateTask).not.toHaveBeenCalled();
  });
});
