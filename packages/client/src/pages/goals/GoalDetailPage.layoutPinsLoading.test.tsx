// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement, type ComponentType } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@timedata/shared";
import { db } from "../../db/index.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { getReactFlowMock, resetReactFlowMock } from "./test/reactFlowMock.js";

let resolveLayoutPins: ((pins: []) => void) | null = null;

vi.mock("@xyflow/react", async () => await import("./test/reactFlowMock.js"));
vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: () => true }));
vi.mock("../../lib/useIsCoarsePointer.js", () => ({ useIsCoarsePointer: () => false }));
vi.mock("../../lib/settings/todoDefaultDestinationSetting.js", () => ({ useTodoDefaultDestination: () => "today" }));
vi.mock("../../lib/goalLayoutPins.js", () => ({
  listGoalLayoutPins: vi.fn(() => new Promise<[]>((resolve) => {
    resolveLayoutPins = resolve;
  })),
}));

const now = "2026-06-25T00:00:00.000Z";
let mountedRoot: Awaited<ReturnType<typeof renderDom>>["root"] | null = null;

const GoalDetailPage = (await import("./GoalDetailPage.js")).default as ComponentType;

beforeEach(async () => {
  await db.delete();
  await db.open();
  resetReactFlowMock();
});

afterEach(async () => {
  if (mountedRoot) await unmount(mountedRoot);
  mountedRoot = null;
  resolveLayoutPins?.([]);
  resolveLayoutPins = null;
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
});
