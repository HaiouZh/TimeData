// @vitest-environment jsdom
// 参考栏块测试：seed 真 db，故 dbReset 必须先于任何触 db/index 的模块求值。
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../test/dbReset.js";
import { renderDom, unmount } from "../../test/domHarness.js";

import { DiaryReferencePanel } from "./DiaryReferencePanel.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  localStorage.clear();
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2000) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function renderPanel(date: string, isToday = true) {
  mounted = await renderDom(createElement(DiaryReferencePanel, { date, isToday }));
  await flush();
  return mounted;
}

describe("参考栏 · 打点块", () => {
  it("列出当天打点，跨零点条目按日界裁剪时长", async () => {
    // 按 CategorySchema 的九个必填字段补全。isArchived 必须显式给 false——
    // useCategories 是 `filter((c) => !c.isArchived)`，这条字段直接决定分类可不可见。
    await db.categories.add({
      id: "cat-1", name: "编程", parentId: null, color: "#3b82f6", icon: null,
      sortOrder: 0, isArchived: false,
      createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z",
    } as never);
    // 本地 2026-07-25 23:00 → 2026-07-26 01:00，在 07-25 上只应算 1 小时
    await db.timeEntries.add({
      id: "e1", categoryId: "cat-1", startTime: "2026-07-25T15:00:00.000Z", endTime: "2026-07-25T17:00:00.000Z",
      note: null, createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z",
    } as never);

    const { host } = await renderPanel("2026-07-25");
    await waitFor(() => host.querySelector('[data-testid="diary-ref-punch-list"]') !== null, "打点列表");

    const list = host.querySelector('[data-testid="diary-ref-punch-list"]') as HTMLElement;
    expect(list.textContent).toContain("编程");
    expect(list.textContent).toContain("1小时");
    expect(list.textContent).not.toContain("2小时");
  });

  it("没有打点时出空态文案", async () => {
    const { host } = await renderPanel("2026-07-25");
    await flush();
    expect(host.textContent).toContain("这天没有打点");
  });
});

describe("参考栏 · 完成的待办块", () => {
  async function addTask(over: Record<string, unknown>) {
    await db.tasks.add({
      parentId: null, title: "写日记", done: true, recurrence: null, lastDoneAt: null,
      startAt: null, scheduledAt: null, completedCount: 0, weight: 0, completedAt: null, tags: [],
      ruleId: null, sessionId: null, skipped: false, sortOrder: 0,
      createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z",
      ...over,
    } as never);
  }

  it("列出当天完成的待办", async () => {
    await addTask({ id: "t1", title: "收尾同步", completedAt: "2026-07-25T02:00:00.000Z" });
    const { host } = await renderPanel("2026-07-25");
    await waitFor(() => host.querySelector('[data-testid="diary-ref-done-task-list"]') !== null, "待办列表");
    expect(host.textContent).toContain("收尾同步");
  });

  it("别的日期完成的不出现在这天", async () => {
    await addTask({ id: "t1", title: "上周干的活", completedAt: "2026-07-20T02:00:00.000Z" });
    const { host } = await renderPanel("2026-07-25");
    await waitFor(() => host.textContent?.includes("这天没有完成的待办") === true, "空态");
    expect(host.textContent).not.toContain("上周干的活");
  });
});
