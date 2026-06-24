// @vitest-environment jsdom
import { act, createElement } from "react";
import type { GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalMemberPicker, type GoalMemberPickerProps } from "./GoalMemberPicker.js";

const now = "2026-06-23T08:00:00.000Z";
let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function task(input: Partial<Task> & Pick<Task, "id" | "title">): Task {
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
    ...input,
  };
}

function track(input: Partial<Track> & Pick<Track, "id" | "title">): Track {
  return {
    id: input.id,
    title: input.title,
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function step(input: Partial<TrackStep> & Pick<TrackStep, "id" | "trackId" | "seq" | "content">): TrackStep {
  return {
    id: input.id,
    trackId: input.trackId,
    seq: input.seq,
    content: input.content,
    source: "user",
    sourceLabel: null,
    refs: [],
    tags: [],
    startedAt: now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function props(overrides: Partial<GoalMemberPickerProps> = {}): GoalMemberPickerProps {
  return {
    tasks: [],
    tracks: [],
    steps: [],
    members: [],
    boardSignals: ["待我处理", "agent在做"],
    archived: false,
    onAddMember: vi.fn<(ref: GoalMemberRef) => void>(),
    onQuickCreateTask: vi.fn<(title: string) => void>(),
    ...overrides,
  };
}

async function renderPicker(overrides: Partial<GoalMemberPickerProps> = {}) {
  mounted = await renderDom(createElement(GoalMemberPicker, props(overrides)));
  return mounted;
}

function inputByLabel(root: ParentNode, label: string): HTMLInputElement {
  const input = root.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input: ${label}`);
  return input;
}

function buttonByLabel(root: ParentNode, label: string): HTMLButtonElement {
  const button = root.querySelector(`button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button label: ${label}`);
  return button;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${text}`);
  return button;
}

async function typeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GoalMemberPicker", () => {
  it("按搜索和标签筛选任务候选并调用 onAddMember", async () => {
    const onAddMember = vi.fn<(ref: GoalMemberRef) => void>();
    const rendered = await renderPicker({
      tasks: [
        task({ id: "task-goal", title: "写星图", tags: ["goal"] }),
        task({ id: "task-report", title: "写周报", tags: ["report"] }),
      ],
      onAddMember,
    });

    await typeInput(inputByLabel(rendered.host, "搜索成员"), "星图");
    await click(buttonByLabel(rendered.host, "筛选 goal"));

    expect(rendered.host.textContent).toContain("写星图");
    expect(rendered.host.textContent).not.toContain("写周报");

    await click(buttonByLabel(rendered.host, "添加任务 写星图"));

    expect(onAddMember).toHaveBeenCalledWith({ kind: "task", id: "task-goal" });
  });

  it("轨道候选显示 active 优先、看板信号和最新步骤", async () => {
    const rendered = await renderPicker({
      tracks: [
        track({ id: "done", title: "归档轨道", status: "concluded", updatedAt: "2026-06-23T09:00:00.000Z" }),
        track({ id: "active", title: "活跃轨道", status: "active", updatedAt: "2026-06-20T09:00:00.000Z" }),
      ],
      steps: [step({ id: "step-1", trackId: "active", seq: 1, content: "等确认", tags: ["待我处理"] })],
    });

    await click(buttonByText(rendered.host, "轨道"));

    const text = rendered.host.textContent ?? "";
    expect(text.indexOf("活跃轨道")).toBeLessThan(text.indexOf("归档轨道"));
    expect(text).toContain("待我处理");
    expect(text).toContain("等确认");
  });

  it("提交快建任务标题时调用 onQuickCreateTask", async () => {
    const onQuickCreateTask = vi.fn<(title: string) => void>();
    const rendered = await renderPicker({ onQuickCreateTask });

    await typeInput(inputByLabel(rendered.host, "新建任务并加入"), "  补验收  ");
    await click(buttonByText(rendered.host, "加入"));

    expect(onQuickCreateTask).toHaveBeenCalledWith("补验收");
  });
});
