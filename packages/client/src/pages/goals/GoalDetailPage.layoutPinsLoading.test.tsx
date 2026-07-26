// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { act, createElement, type ComponentType } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@timedata/shared";
import { db } from "../../db/index.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { getReactFlowMock, resetReactFlowMock } from "./test/reactFlowMock.js";

let resolveLayoutPins: ((pins: []) => void) | null = null;
let resolveTasks: ((tasks: []) => void) | null = null;

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));
vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));
vi.mock("../../lib/useIsCoarsePointer.js", () => ({ useIsCoarsePointer: () => false }));
vi.mock("../../lib/settings/todoDefaultDestinationSetting.js", () => ({ useTodoDefaultDestination: () => "today" }));
vi.mock("../../lib/goalLayoutPins.js", () => ({
  listGoalLayoutPins: vi.fn(() => new Promise<[]>((resolve) => {
    resolveLayoutPins = resolve;
  })),
}));
// 默认立即返回：否则 tasks 也挂起，会让下面「layoutPins 未加载前不挂图」那条退化成怎样都通过。
const listAllTasksForGoalsMock = vi.hoisted(() => vi.fn());
vi.mock("./goalPageData.js", () => ({ listAllTasksForGoals: listAllTasksForGoalsMock }));

const now = "2026-06-25T00:00:00.000Z";
let mountedRoot: Awaited<ReturnType<typeof renderDom>>["root"] | null = null;

const GoalDetailPage = (await import("./GoalDetailPage.js")).default as ComponentType;

beforeEach(async () => {
  await db.delete();
  await db.open();
  resetReactFlowMock();
  listAllTasksForGoalsMock.mockReset();
  listAllTasksForGoalsMock.mockResolvedValue([]);
});

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
  resolveLayoutPins?.([]);
  resolveLayoutPins = null;
  resolveTasks?.([]);
  resolveTasks = null;
  await tick();
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

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 反复放行 layoutPins 的挂起 promise（mock 每次调用都新建一个），直到它不再是闸门的原因。 */
async function settleLayoutPins(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    resolveLayoutPins?.([]);
    await tick();
  }
}

function sourcePath(fileName: string): string {
  return join(process.cwd(), "src/pages/goals", fileName);
}

async function renderGoalDetail() {
  const rendered = await renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: ["/goals/goal-1"] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/goals/:id", element: createElement(GoalDetailPage) }),
      ),
    ),
  );
  mountedRoot = rendered.root;
  return rendered;
}

describe("GoalDetailPage layout pins loading", () => {
  it("does not mount or fit the graph before layout pins are loaded", async () => {
    await db.goals.add(goal());

    const { host } = await renderGoalDetail();
    await tick();

    expect(host.querySelector('[data-rf="true"]')).toBeNull();
    expect(getReactFlowMock().fitView).not.toHaveBeenCalled();
  });

  it("不在 tasks live query 返回前挂载编辑器，返回后才挂", async () => {
    await db.goals.add(goal());
    listAllTasksForGoalsMock.mockReturnValue(
      new Promise<[]>((resolve) => {
        resolveTasks = resolve;
      }),
    );

    const { host } = await renderGoalDetail();
    // layoutPins 的 mock 每次被调用都新建挂起 promise，只 resolve 一次不够；
    // 反复放行直到它这一路真的走完，断言才不依赖 tick 轮数。
    await settleLayoutPins();

    // tasks 仍未返回：停在加载态，不许以 [] 兜底挂图
    expect(host.textContent).toContain("正在加载");
    expect(host.querySelector('[data-rf="true"]')).toBeNull();
    expect(getReactFlowMock().fitView).not.toHaveBeenCalled();

    resolveTasks?.([]);
    resolveTasks = null;
    await settleLayoutPins();

    // tasks 到位后闸门要真的打开
    expect(host.querySelector('[data-rf="true"]')).toBeTruthy();
  });

  it("不给 tasks/tracks/steps 传 useLiveQuery 默认初值", async () => {
    const source = await readFile(sourcePath("GoalDetailPage.tsx"), "utf8");
    // 先确认读到的是目标文件，避免路径错时这条闸静默失效
    expect(source).toContain("listAllTasksForGoals");
    expect(source).not.toMatch(/useLiveQuery\(.*,\s*\[\s*\],\s*\[\s*\]\s*\)/);
  });
});
