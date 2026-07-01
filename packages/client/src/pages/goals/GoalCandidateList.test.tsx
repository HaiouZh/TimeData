// @vitest-environment jsdom
import type { Task } from "@timedata/shared";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { GoalCandidateList } from "./GoalCandidateList.js";
import { buildGoalTaskCandidates, taskCandidateGroups } from "./goalMemberCandidates.js";

const now = new Date("2026-06-23T08:00:00.000Z");
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
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...input,
  };
}

function taskGroupsFrom(tasks: Task[]) {
  return taskCandidateGroups(
    buildGoalTaskCandidates(tasks, [], { now, searchQuery: "", includeTags: [], excludeTags: [], tagMode: "and" }),
  );
}

describe("GoalCandidateList", () => {
  it("拖拽模式：根可拖带 tray-ref；子任务默认折叠，展开后只读不可拖", async () => {
    const tasks = [
      task({ id: "root", title: "父任务", sortOrder: 1 }),
      task({ id: "child", title: "子条目", parentId: "root", sortOrder: 1 }),
    ];
    mounted = await renderDom(
      createElement(GoalCandidateList, {
        tab: "tasks",
        taskGroups: taskGroupsFrom(tasks),
        trackGroups: [],
        emptyLabel: "没有未归类项",
        interaction: { mode: "drag" },
      }),
    );

    const rootBtn = mounted.host.querySelector('[data-tray-ref="task:root"]');
    expect(rootBtn).toBeTruthy();
    expect((rootBtn as HTMLElement).getAttribute("draggable")).toBe("true");
    expect(mounted.host.textContent).not.toContain("子条目");

    await click(mounted.host.querySelector('button[aria-label="展开子任务 父任务"]'));

    expect(mounted.host.textContent).toContain("子条目");
    const childEl = mounted.host.querySelector('[data-child-ref="task:child"]');
    expect(childEl).toBeTruthy();
    expect((childEl as HTMLElement).getAttribute("data-tray-ref")).toBeNull();
    expect((childEl as HTMLElement).getAttribute("draggable")).toBeNull();
  });

  it("无子任务的根不渲染展开箭头", async () => {
    mounted = await renderDom(
      createElement(GoalCandidateList, {
        tab: "tasks",
        taskGroups: taskGroupsFrom([task({ id: "solo", title: "独任务" })]),
        trackGroups: [],
        emptyLabel: "空",
        interaction: { mode: "drag" },
      }),
    );
    expect(mounted.host.querySelector('button[aria-label^="展开子任务"]')).toBeNull();
  });

  it("点击模式：点根调用 onSelect", async () => {
    const onSelect = vi.fn<(ref: { kind: string; id: string }) => void>();
    mounted = await renderDom(
      createElement(GoalCandidateList, {
        tab: "tasks",
        taskGroups: taskGroupsFrom([task({ id: "root", title: "父任务" })]),
        trackGroups: [],
        emptyLabel: "空",
        interaction: { mode: "click", onSelect },
      }),
    );
    await click(mounted.host.querySelector('button[aria-label="添加任务 父任务"]'));
    expect(onSelect).toHaveBeenCalledWith({ kind: "task", id: "root" });
  });

  it("空组渲染 emptyLabel", async () => {
    mounted = await renderDom(
      createElement(GoalCandidateList, {
        tab: "tasks",
        taskGroups: [],
        trackGroups: [],
        emptyLabel: "没有未归类项",
        interaction: { mode: "drag" },
      }),
    );
    expect(mounted.host.textContent).toContain("没有未归类项");
  });
});
