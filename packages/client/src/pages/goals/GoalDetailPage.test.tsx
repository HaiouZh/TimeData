// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, Task } from "@timedata/shared";
import { db } from "../../db/index.js";
import { toggleTaskDone } from "../../lib/tasks.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import GoalDetailPage from "./GoalDetailPage.js";

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));
vi.mock("../../contexts/SyncContext.js", () => ({ useSyncContext: () => ({ syncAfterWrite: vi.fn() }) }));
vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));
vi.mock("../../lib/useIsCoarsePointer.js", () => ({ useIsCoarsePointer: () => false }));
vi.mock("../../lib/settings/todoDefaultDestinationSetting.js", () => ({ useTodoDefaultDestination: () => "today" }));

const now = "2026-06-23T01:00:00.000Z";
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

async function renderGoalDetail(initialPath = "/goals/goal-1") {
  const rendered = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [initialPath] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/goals/:id", element: createElement(GoalDetailPage) }),
        createElement(Route, { path: "/goals", element: createElement("div", { "data-route": "goals" }, "目标列表") }),
      ),
    ),
  );
  mountedRoot = rendered.root;
  return rendered;
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForText(text: string): Promise<void> {
  for (let index = 0; index < 30; index++) {
    if (document.body.textContent?.includes(text)) return;
    await tick();
  }
  expect(document.body.textContent).toContain(text);
}

async function waitForSelector(selector: string): Promise<Element> {
  for (let index = 0; index < 30; index++) {
    const element = document.body.querySelector(selector);
    if (element) return element;
    await tick();
  }
  throw new Error(`missing selector: ${selector}`);
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${text}`);
  return button;
}

describe("GoalDetailPage graph shell", () => {
  it("shows loading and missing-goal states", async () => {
    await renderGoalDetail("/goals/missing");

    await waitForText("目标不存在");
  });

  it("mounts GoalGraphEditor with the goal anchor", async () => {
    await db.goals.add(goal());

    await renderGoalDetail();

    expect(await waitForSelector('[data-node-id="goal"]')).not.toBeNull();
    expect(document.body.textContent).toContain("0 能推 · 0 等前置 · 0 完成");
  });

  it("live-refreshes graph summary when a task changes", async () => {
    const goalValue = goal({ members: [{ kind: "task", id: "task-1" }] });
    const taskValue = task("task-1", { title: "写说明" });
    await db.goals.add(goalValue);
    await db.tasks.add(taskValue);

    await renderGoalDetail();

    await waitForText("1 能推 · 0 等前置 · 0 完成");

    await toggleTaskDone("task-1");

    await waitForText("0 能推 · 0 等前置 · 1 完成");
  });

  it("deleting the goal in the editor navigates back to /goals", async () => {
    await db.goals.add(goal());

    await renderGoalDetail();
    await click(await waitForSelector('button[aria-label="目标菜单"]'));
    await click(buttonByText(document.body, "删除目标"));
    await click([...document.body.querySelectorAll("button")].filter((button) => button.textContent === "删除目标").at(-1));

    await waitForText("目标列表");
    expect(await db.goals.get("goal-1")).toBeUndefined();
  });
});
