// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, GoalMemberRef, Task, Track, TrackStep } from "@timedata/shared";
import { db } from "../../db/index.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));
vi.mock("../../contexts/SyncContext.js", () => ({ useSyncContext: () => ({ syncAfterWrite: vi.fn() }) }));
vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));
vi.mock("../../lib/useIsCoarsePointer.js", () => ({ useIsCoarsePointer: () => false }));
vi.mock("../../lib/settings/todoDefaultDestinationSetting.js", () => ({ useTodoDefaultDestination: () => "today" }));

const { GoalGraphEditor } = await import("./GoalGraphEditor.js");

const now = "2026-06-23T00:00:00.000Z";
let mountedRoot: Awaited<ReturnType<typeof renderDom>>["root"] | null = null;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
  await db.delete();
});

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    parentId: null,
    title: id,
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
    ...overrides,
  };
}

function track(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: id,
    status: "active",
    refs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seed(goalValue: Goal, tasks: Task[] = [], tracks: Track[] = []): Promise<void> {
  await db.goals.add(goalValue);
  await db.tasks.bulkAdd(tasks);
  if (tracks.length > 0) await db.tracks.bulkAdd(tracks);
}

async function renderEditor(options: {
  goal?: Goal;
  tasks?: Task[];
  tracks?: Track[];
  steps?: TrackStep[];
  onNavigate?: (to: string) => void;
  onDeletedGoal?: () => void;
} = {}) {
  const goalValue = options.goal ?? goal();
  const rendered = await renderDom(
    createElement(GoalGraphEditor, {
      goal: goalValue,
      tasks: options.tasks ?? [],
      tracks: options.tracks ?? [],
      steps: options.steps ?? [],
      onNavigate: options.onNavigate ?? vi.fn(),
      onDeletedGoal: options.onDeletedGoal ?? vi.fn(),
    }),
  );
  mountedRoot = rendered.root;
  return rendered;
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForStatusText(text: string): Promise<HTMLElement> {
  for (let index = 0; index < 30; index++) {
    const status = document.body.querySelector('[role="status"]');
    if (status instanceof HTMLElement && status.textContent?.includes(text)) return status;
    await tick();
  }
  throw new Error(`missing status text: ${text}`);
}

async function waitForGoalWhere(predicate: (goal: Goal | undefined) => boolean, label: string): Promise<Goal | undefined> {
  for (let index = 0; index < 30; index++) {
    const row = await db.goals.get("goal-1");
    if (predicate(row)) return row;
    await tick();
  }
  throw new Error(`goal condition not met: ${label}`);
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

function nodeButton(host: ParentNode, id: string): HTMLButtonElement {
  const button = host.querySelector(`[data-node-id="${id}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing node: ${id}`);
  return button;
}

function edgeButton(host: ParentNode, id: string): HTMLButtonElement {
  const button = host.querySelector(`[data-edge-id="${id}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing edge: ${id}`);
  return button;
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GoalGraphEditor", () => {
  it("空 Goal 渲染锚节点和工具栏添加成员入口", async () => {
    const goalValue = goal();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue });

    expect(host.querySelector('[data-rf="true"]')).not.toBeNull();
    expect(host.querySelector('[data-node-id="goal"]')).not.toBeNull();
    expect(buttonByLabel(host, "添加成员")).toBeInstanceOf(HTMLButtonElement);
  });

  it("点节点只选中，打开动作才导航到任务深链", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    const onNavigate = vi.fn<(to: string) => void>();
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [taskValue], onNavigate });

    await click(nodeButton(host, "task:task-1"));
    expect(onNavigate).not.toHaveBeenCalled();

    await click(buttonByLabel(document.body, "打开 写说明"));
    expect(onNavigate).toHaveBeenCalledWith("/todo?taskId=task-1");
  });

  it("Task 快速完成写入 db", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [taskValue] });

    await click(nodeButton(host, "task:task-1"));
    await click(buttonByLabel(document.body, "完成 写说明"));
    await tick();

    expect((await db.tasks.get("task-1"))?.done).toBe(true);
  });

  it("移出成员后轻撤销还原成员和级联删除的前置", async () => {
    const members: GoalMemberRef[] = [
      { kind: "task", id: "task-1" },
      { kind: "task", id: "task-2" },
    ];
    const goalValue = goal({
      members,
      prerequisites: [{ blocker: members[0], blocked: members[1] }],
    });
    const first = task("task-1", { title: "A" });
    const second = task("task-2", { title: "B" });
    await seed(goalValue, [first, second]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [first, second] });

    await click(nodeButton(host, "task:task-1"));
    await click(buttonByLabel(document.body, "移除成员 A"));
    await tick();

    let row = await db.goals.get("goal-1");
    expect(row?.members).toEqual([members[1]]);
    expect(row?.prerequisites).toEqual([]);
    await waitForStatusText("撤销");

    await click(document.body.querySelector("[data-goal-undo-action]"));

    row = await waitForGoalWhere((candidate) => candidate?.members.length === 2, "restored members");
    expect(row?.members).toEqual(members);
    expect(row?.prerequisites).toEqual([{ blocker: members[0], blocked: members[1] }]);
  });

  it("onConnect 校验通过后写入 blocker -> blocked 前置", async () => {
    const members: GoalMemberRef[] = [
      { kind: "task", id: "t1" },
      { kind: "task", id: "t2" },
    ];
    const goalValue = goal({ members });
    const first = task("t1");
    const second = task("t2");
    await seed(goalValue, [first, second]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [first, second] });

    await click(host.querySelector("[data-rf-connect='true']"));
    await tick();

    expect((await db.goals.get("goal-1"))?.prerequisites).toEqual([{ blocker: members[0], blocked: members[1] }]);
  });

  it("删前置边后可撤销", async () => {
    const members: GoalMemberRef[] = [
      { kind: "task", id: "task-1" },
      { kind: "task", id: "task-2" },
    ];
    const goalValue = goal({
      members,
      prerequisites: [{ blocker: members[0], blocked: members[1] }],
    });
    const first = task("task-1", { title: "A" });
    const second = task("task-2", { title: "B" });
    await seed(goalValue, [first, second]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [first, second] });
    const edgeId = "prerequisite:task:task-1->task:task-2";

    await click(edgeButton(host, edgeId));
    await click(buttonByLabel(document.body, "删除前置"));
    await tick();

    expect((await db.goals.get("goal-1"))?.prerequisites).toEqual([]);

    await click(document.body.querySelector("[data-goal-undo-action]"));

    const restored = await waitForGoalWhere(
      (candidate) => candidate?.prerequisites.length === 1,
      "restored prerequisite",
    );
    expect(restored?.prerequisites).toEqual([{ blocker: members[0], blocked: members[1] }]);
  });

  it("添加已有成员和快建任务写入 db", async () => {
    const goalValue = goal();
    const taskValue = task("task-1", { title: "已有任务" });
    await seed(goalValue, [taskValue]);

    const { host } = await renderEditor({ goal: goalValue, tasks: [taskValue] });

    await click(buttonByLabel(host, "添加成员"));
    await click(buttonByLabel(document.body, "添加任务成员"));
    await click(buttonByText(document.body, "已有任务"));
    await tick();
    expect((await db.goals.get("goal-1"))?.members).toEqual([{ kind: "task", id: "task-1" }]);

    const input = document.body.querySelector('input[aria-label="新建任务并加入"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing quick create input");
    await setInputValue(input, "  新任务  ");
    await click(buttonByText(document.body, "加入"));
    await tick();

    const tasks = await db.tasks.toArray();
    expect(tasks.map((item) => item.title).sort()).toEqual(["已有任务", "新任务"]);
    expect((await db.goals.get("goal-1"))?.members).toHaveLength(2);
  });

  it("目标菜单可编辑、归档和删除目标", async () => {
    const goalValue = goal();
    const onDeletedGoal = vi.fn<() => void>();
    await seed(goalValue);

    const { host } = await renderEditor({ goal: goalValue, onDeletedGoal });

    await click(buttonByLabel(host, "目标菜单"));
    const titleInput = document.body.querySelector('input[aria-label="目标标题"]');
    if (!(titleInput instanceof HTMLInputElement)) throw new Error("missing title input");
    await setInputValue(titleInput, "  发布 v3  ");
    await click(buttonByText(document.body, "保存目标"));
    await tick();

    expect((await db.goals.get("goal-1"))?.title).toBe("发布 v3");

    await click(buttonByText(document.body, "归档目标"));
    await tick();
    expect((await db.goals.get("goal-1"))?.status).toBe("archived");

    await click(buttonByText(document.body, "删除目标"));
    await click([...document.body.querySelectorAll("button")].filter((button) => button.textContent === "删除目标").at(-1));
    await tick();

    expect(await db.goals.get("goal-1")).toBeUndefined();
    expect(onDeletedGoal).toHaveBeenCalledTimes(1);
  });
});
