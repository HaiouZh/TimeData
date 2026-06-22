// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, Task, Track } from "@timedata/shared";
import { db } from "../../db/index.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import GoalDetailPage from "./GoalDetailPage.js";

vi.mock("../../contexts/SyncContext.js", () => ({ useSyncContext: () => ({ syncAfterWrite: vi.fn() }) }));

const now = "2026-06-22T01:00:00.000Z";
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

function seedGoal(overrides: Partial<Goal> = {}): Promise<string> {
  const goal: Goal = {
    id: "goal-1",
    title: "发布 v2",
    kind: "project",
    status: "active",
    prerequisites: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return db.goals.add(goal);
}

function seedTask(overrides: Partial<Task> & Pick<Task, "id">): Promise<string> {
  const task: Task = {
    id: overrides.id,
    parentId: null,
    goalId: overrides.goalId ?? null,
    title: overrides.title ?? overrides.id,
    done: overrides.done ?? false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return db.tasks.add(task);
}

function seedTrack(overrides: Partial<Track> & Pick<Track, "id">): Promise<string> {
  const track: Track = {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? "active",
    refs: [],
    goalId: overrides.goalId ?? null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return db.tracks.add(track);
}

async function renderGoalDetail(id = "goal-1") {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: [`/goals/${id}`] },
      createElement(Routes, null, createElement(Route, { path: "/goals/:id", element: createElement(GoalDetailPage) })),
    ),
  );
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  for (let index = 0; index < 30; index++) {
    if (document.body.textContent?.includes(text) || host.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(document.body.textContent).toContain(text);
}

function findButtonByText(root: ParentNode, text: string): HTMLButtonElement | null {
  const buttons = [...root.querySelectorAll("button")];
  const button = buttons.find((item) => item.textContent?.includes(text));
  return button instanceof HTMLButtonElement ? button : null;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = findButtonByText(root, text);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${text}`);
  return button;
}

async function waitForButtonByText(root: ParentNode, text: string): Promise<HTMLButtonElement> {
  for (let index = 0; index < 30; index++) {
    const button = findButtonByText(root, text);
    if (button) return button;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`missing button: ${text}`);
}

async function waitForButtonByLabel(root: ParentNode, label: string): Promise<HTMLButtonElement> {
  for (let index = 0; index < 30; index++) {
    const button = root.querySelector(`button[aria-label="${label}"]`);
    if (button instanceof HTMLButtonElement) return button;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`missing button label: ${label}`);
}

async function chooseSelectSheetOption(host: HTMLElement, label: string, option: string): Promise<void> {
  await waitForText(host, option);
  await click(await waitForButtonByLabel(host, label));
  await click(await waitForButtonByText(document.body, option));
}

describe("GoalDetailPage", () => {
  it("renders ready and blocked member columns", async () => {
    await seedGoal({ prerequisites: [{ blocker: "task-1", blocked: "track-1" }] });
    await seedTask({ id: "task-1", title: "写发布文案", done: false, goalId: "goal-1" });
    await seedTrack({ id: "track-1", title: "发布轨道", status: "active", goalId: "goal-1" });

    const { host, root } = await renderGoalDetail();
    mountedRoot = root;

    await waitForText(host, "现在能推进");
    await waitForText(host, "写发布文案");
    await waitForText(host, "在等前置");
    await waitForText(host, "发布轨道");
    await waitForText(host, "等：写发布文案");
  });

  it("adds prerequisite edges", async () => {
    await seedGoal();
    await seedTask({ id: "task-1", title: "写发布文案", goalId: "goal-1" });
    await seedTrack({ id: "track-1", title: "发布轨道", status: "active", goalId: "goal-1" });

    const { host, root } = await renderGoalDetail();
    mountedRoot = root;

    await chooseSelectSheetOption(host, "选择前置成员", "写发布文案");
    await chooseSelectSheetOption(host, "选择受阻成员", "发布轨道");
    await click(host.querySelector('button[aria-label="添加前置关系"]'));

    await expect(db.goals.get("goal-1")).resolves.toMatchObject({
      prerequisites: [{ blocker: "task-1", blocked: "track-1" }],
    });
  });

  it("deletes a goal after confirmation and keeps members", async () => {
    await seedGoal();
    await seedTask({ id: "task-1", title: "写发布文案", goalId: "goal-1" });

    const { host, root } = await renderGoalDetail();
    mountedRoot = root;

    await waitForText(host, "删除目标");
    await click(host.querySelector('button[aria-label="删除目标"]'));
    await click(buttonByText(document.body, "删除目标"));

    await expect(db.goals.get("goal-1")).resolves.toBeUndefined();
    await expect(db.tasks.get("task-1")).resolves.toMatchObject({ goalId: null });
  });
});
