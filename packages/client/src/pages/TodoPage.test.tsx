// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Task } from "@timedata/shared";
import { act, createElement, useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { db } from "../db/index.js";
import { grabTaskToHand } from "../lib/sessions.js";
import { getSetting } from "../lib/settings/index.js";
import { setTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import { addTask, createChildTask, scheduleTask, setTaskTags, toggleTaskDone } from "../lib/tasks.js";
import { normalizeScheduledDate } from "../lib/tasks/placement.js";
import { setProjectZoneIntroDismissed } from "../lib/tasks/workbenchPrefs.js";
import { renderDom, unmount } from "../test/domHarness.js";
import { TodoPage } from "./TodoPage.js";

beforeEach(async () => {
  localStorage.clear();
  vi.unstubAllGlobals();
  await db.tasks.clear();
  await db.settings.clear();
  await db.syncLog.clear();
  await db.goals.clear();
  // sessions 与上面四张表一起列全：本文件有用例 grabTaskToHand 开场，漏了它的话，
  // 一旦本文件哪天迁进 isolate:false 的快桶、或全局 afterEach 的兜底清表被改窄，
  // 上一条的活跃场就会漏给下一条，任务被 listTasks 截进手头区、整页断言跑偏。
  await db.sessions.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function HideBottomNavOnMount() {
  const { setHidden } = useBottomNav();
  useEffect(() => {
    setHidden(true);
  }, [setHidden]);
  return null;
}

async function renderPage({ hideBottomNav = false } = {}) {
  return renderDom(
    createElement(
      MemoryRouter,
      null,
      createElement(
        BottomNavProvider,
        null,
        hideBottomNav ? createElement(HideBottomNavOnMount) : null,
        createElement(SyncProvider, null, createElement(TodoPage)),
      ),
    ),
  );
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * 让 Dexie/fake-indexeddb 的事务真的提交：flushAsync 只清微任务，多段事务（详情抽屉那条链）要让出宏任务。
 * 抽屉相关用例一律用它推进，否则断言会抢在写入之前跑、把"还没到"误判成"不会发生"。
 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function waitForCondition(
  assertion: () => boolean,
  label: string,
  step: () => Promise<void> = flushAsync,
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (assertion()) return;
    await step();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForText(host: HTMLElement, text: string): Promise<void> {
  await waitForCondition(() => host.textContent?.includes(text) ?? false, text);
}

/** 落库轮询：断言"不该展开"之前必须先等写入真的落了，否则测的是"还没跑到"。 */
async function waitForTask(id: string, predicate: (task: Task | undefined) => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate(await db.tasks.get(id))) return;
    await settle();
  }
  throw new Error(`Timed out waiting for task ${id}`);
}

function zoneText(host: HTMLElement): string {
  return (host.querySelector('[data-section="todo-projects"]') as HTMLElement | null)?.textContent ?? "";
}

async function seedProjectGoal(memberId: string, createdAt = "2026-06-28T09:00:00.000Z"): Promise<void> {
  await db.goals.add({
    id: "g1",
    title: "装修",
    kind: "project",
    status: "active",
    members: [{ kind: "task", id: memberId }],
    prerequisites: [],
    createdAt,
    updatedAt: createdAt,
  });
}

/** 从行打开详情抽屉 → 点开「重复与时间」预设面板。 */
async function openRecurrencePresets(host: HTMLElement, title: string): Promise<void> {
  const row = host.querySelector(`[aria-label="打开 ${title}"]`);
  expect(row).not.toBeNull();
  await act(async () => {
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
  const badge = host.querySelector('[role="dialog"][aria-label="任务详情"] button[aria-label="编辑重复与时间"]');
  expect(badge).not.toBeNull();
  await act(async () => {
    badge?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function openGravityReview(host: HTMLElement): Promise<void> {
  const details = host.querySelector('[data-section="todo-gravity-review"] details') as HTMLDetailsElement;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle", { bubbles: true }));
  });
  await flushAsync();
}

async function typeAndAdd(host: HTMLElement, title: string) {
  const input = host.querySelector('input[placeholder="做什么？怎样算做完…"]') as HTMLInputElement;
  const form = host.querySelector("form");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("TodoPage", () => {
  it("已归入 active theme 目标的收件箱任务带外圈标记，未归入的不带", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    const linked = await addTask({ title: "已归目标任务", toInbox: true });
    await addTask({ title: "自由任务", toInbox: true });
    await db.goals.add({
      id: "g1",
      title: "目标一",
      kind: "theme",
      status: "active",
      members: [{ kind: "task", id: linked.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });

    const { host, root } = await renderPage();
    await waitForText(host, "已归目标任务");
    await waitForCondition(() => {
      const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
      return (inbox?.querySelectorAll("[data-in-goal='true']").length ?? 0) === 1;
    }, "linked inbox task to get goal ring");

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    const marked = inbox.querySelectorAll("[data-in-goal='true']");
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent ?? "").toContain("已归目标任务");
    await unmount(root);
  });

  it("渲染四分区：今天 / 已完成 / 收件箱 / 已排期，且不再出现旧分区名", async () => {
    const today = await addTask({ title: "今天事" });
    await addTask({ title: "稍后处理", toInbox: true });
    const future = await addTask({ title: "未来任务", toInbox: true });
    await scheduleTask(future.id, "2099-12-25");
    const doneOne = await addTask({ title: "完事了", toInbox: true });
    await toggleTaskDone(doneOne.id);

    const { host, root } = await renderPage();
    await waitForText(host, "今天事");

    expect(host.textContent).toContain("今天");
    expect(host.textContent).toContain("已完成");
    expect(host.textContent).toContain("收件箱");
    expect(host.textContent).toContain("已排期");
    // 旧分区名不应再出现。
    expect(host.textContent ?? "").not.toContain("即将到来");
    expect(host.textContent ?? "").not.toContain("重复 / 提醒");

    expect(host.querySelector('[data-section="today"]')).not.toBeNull();
    expect(host.querySelector('[data-section="inbox"]')).not.toBeNull();
    expect(today).toBeTruthy();
    await unmount(root);
  });

  it("已排期水位线：7 天内在水上，更远折叠成「更远还有 N 条」，点开可见", async () => {
    const ymd = (offsetDays: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const near = await addTask({ title: "近期排期", toInbox: true });
    await scheduleTask(near.id, ymd(2));
    const far = await addTask({ title: "远期排期", toInbox: true });
    await scheduleTask(far.id, ymd(30));

    const { host, root } = await renderPage();
    await waitForText(host, "近期排期");
    expect(host.textContent).not.toContain("远期排期");
    await waitForText(host, "更远还有 1 条");

    const btn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("更远还有 1 条"),
    ) as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForText(host, "远期排期");
    await unmount(root);
  });

  it("已排期水位线：搜索过滤激活时水下命中直接显示", async () => {
    const ymd = (offsetDays: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const far = await addTask({ title: "远期独有词", toInbox: true });
    await scheduleTask(far.id, ymd(30));

    const { host, root } = await renderPage();
    await waitForText(host, "更远还有 1 条");
    expect(host.textContent).not.toContain("远期独有词");

    const input = host.querySelector('input[placeholder="做什么？怎样算做完…"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "远期独有词");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitForText(host, "远期独有词");
    await unmount(root);
  });

  it("默认落点=今天：添加进今天（scheduledAt 非空）", async () => {
    const { host, root } = await renderPage();
    await typeAndAdd(host, "默认今天");
    await waitForText(host, "默认今天");
    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].scheduledAt).not.toBeNull();
    expect(tasks[0].recurrence).toBeNull();
    await unmount(root);
  });

  it("默认落点=收件箱：添加进收件箱（scheduledAt 为空）", async () => {
    await setTodoDefaultDestination("inbox");
    const { host, root } = await renderPage();
    await typeAndAdd(host, "丢收件箱");
    await waitForText(host, "丢收件箱");
    const tasks = await db.tasks.toArray();
    expect(tasks[0].scheduledAt).toBeNull();
    await unmount(root);
  });

  // 回归：收件箱行的「排进今天」(→) 把任务排进今天。曾因 moveToToday 传 localDateOf(ISO)
  // 给 scheduleTask（期望 "YYYY-MM-DD"），normalizeScheduledDate 解析出 NaN → Invalid time value
  // 抛错且未捕获，任务原地不动（用户报「点了没反应」）。
  it("点收件箱行「排进今天」→ 任务移入今天且 scheduledAt 落库", async () => {
    await addTask({ title: "收件箱条目", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "收件箱条目");

    const btn = host.querySelector('[aria-label="排进今天 收件箱条目"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 等 dexie liveQuery → 重渲染把任务从收件箱挪到今天分区。
    await waitForCondition(() => {
      const today = host.querySelector('[data-section="today"]') as HTMLElement | null;
      return today?.textContent?.includes("收件箱条目") ?? false;
    }, "task to move to today section");

    const tasks = await db.tasks.toArray();
    expect(tasks[0]?.scheduledAt).not.toBeNull();
    const todaySection = host.querySelector('[data-section="today"]') as HTMLElement | null;
    expect(todaySection?.textContent ?? "").toContain("收件箱条目");
    const inboxSection = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
    expect(inboxSection?.textContent ?? "").not.toContain("收件箱条目");
    await unmount(root);
  });

  it("点任务行打开详情抽屉", async () => {
    await addTask({ title: "点我打开" });
    const { host, root } = await renderPage();
    await waitForText(host, "点我打开");
    const row = host.querySelector('[aria-label="打开 点我打开"]')!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    expect(host.querySelector('[role="dialog"][aria-label="任务详情"]')).not.toBeNull();
    await unmount(root);
  });

  it("待办页不再渲染旧 parent drop zone", async () => {
    await addTask({ title: "父" });
    const { host, root } = await renderPage();
    await waitForText(host, "父");

    expect(host.querySelector('[data-testid="parent-drop-zone"]')).toBeNull();
    await unmount(root);
  });

  it("root 行渲染左侧拖拽抓取区", async () => {
    await addTask({ title: "可拖任务" });
    const { host, root } = await renderPage();
    await waitForText(host, "可拖任务");

    expect(host.querySelector('[data-testid="task-row-grab-area"]')).not.toBeNull();
    await unmount(root);
  });

  it("不再渲染注意力区", async () => {
    await addTask({ title: "普通任务", toInbox: true });

    const { host, root } = await renderPage();
    await waitForText(host, "普通任务");

    expect(host.querySelector('[data-testid="attention-queue"]')).toBeNull();
    await unmount(root);
  });

  it("tag 筛选作用于普通任务池", async () => {
    const a = await addTask({ title: "任务 A", toInbox: true });
    await setTaskTags(a.id, ["x"]);
    const b = await addTask({ title: "普通任务 B", toInbox: true });
    await setTaskTags(b.id, ["y"]);

    const { host, root } = await renderPage();
    await waitForText(host, "任务 A");
    await waitForText(host, "普通任务 B");

    await act(async () => (host.querySelector('[aria-label="展开标签筛选"]') as HTMLButtonElement).click());
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });

    const filterY = host.querySelector('[aria-label="筛选 y"]') as HTMLButtonElement;
    expect(filterY).not.toBeNull();
    await act(async () => filterY.click());
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    const inboxSectionAfterY = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
    expect(inboxSectionAfterY?.textContent ?? "").not.toContain("任务 A");
    expect(inboxSectionAfterY?.textContent ?? "").toContain("普通任务 B");

    await act(async () => filterY.click());
    const filterX = host.querySelector('[aria-label="筛选 x"]') as HTMLButtonElement;
    await act(async () => filterX.click());
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });
    const inboxSection = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
    expect(inboxSection?.textContent ?? "").toContain("任务 A");
    expect(inboxSection?.textContent ?? "").not.toContain("普通任务 B");

    await unmount(root);
  });

  it("选含标签→收面板→搜索：标签上下文与关键词叠加（搜索 ∩ 标签）", async () => {
    const a = await addTask({ title: "写工作报告", toInbox: true });
    await setTaskTags(a.id, ["工作"]);
    const b = await addTask({ title: "工作杂事", toInbox: true });
    await setTaskTags(b.id, ["工作"]);
    const c = await addTask({ title: "生活报告", toInbox: true });
    await setTaskTags(c.id, ["生活"]);

    const { host, root } = await renderPage();
    await waitForText(host, "写工作报告");

    const clickEl = async (sel: string) => {
      await act(async () => (host.querySelector(sel) as HTMLButtonElement).click());
      await act(async () => {
        await new Promise((r) => window.setTimeout(r, 0));
      });
    };
    await clickEl('[aria-label="展开标签筛选"]');
    await clickEl('[aria-label="筛选 工作"]');
    await clickEl('[aria-label="收起标签筛选"]');

    const inputEl = host.querySelector('input[placeholder="做什么？怎样算做完…"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(inputEl, "报告");
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    expect(inbox.textContent ?? "").toContain("写工作报告");
    expect(inbox.textContent ?? "").not.toContain("工作杂事");
    expect(inbox.textContent ?? "").not.toContain("生活报告");
    await unmount(root);
  });

  it("底栏和输入框隐藏时，收件箱展开的收起按钮不避让已滑出视口的输入框", async () => {
    const now = new Date("2026-06-20T09:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLFormElement) {
        return {
          x: 0,
          y: 0,
          width: 390,
          height: 120,
          top: 0,
          right: 390,
          bottom: 120,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    });

    await addTask({ title: "今天收件箱", toInbox: true, now });
    await addTask({ title: "昨天收件箱", toInbox: true, now: new Date("2026-06-19T09:00:00.000Z") });
    await addTask({ title: "前天收件箱", toInbox: true, now: new Date("2026-06-18T09:00:00.000Z") });
    await addTask({ title: "更早收件箱", toInbox: true, now: new Date("2026-06-17T09:00:00.000Z") });

    const { host, root } = await renderPage({ hideBottomNav: true });
    await waitForText(host, "今天收件箱");

    const inboxSection = host.querySelector('[data-section="inbox"]') as HTMLElement | null;
    expect(inboxSection).not.toBeNull();
    await act(async () => {
      (inboxSection?.querySelector('[aria-label^="显示更多"]') as HTMLButtonElement | null)?.click();
    });
    await act(async () => {
      await new Promise((r) => window.setTimeout(r, 0));
    });

    const collapse = inboxSection?.querySelector('[aria-label="收起"]') as HTMLButtonElement | null;
    expect(collapse).not.toBeNull();
    expect(collapse?.style.bottom).toBe("4px");

    await unmount(root);
  });

  it("hides sunken inbox tasks from the default inbox list", async () => {
    await addTask({ title: "新想法", toInbox: true });
    await addTask({ title: "旧想法", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });
    const { host, root } = await renderPage();
    await waitForText(host, "新想法");

    expect(host.querySelector('[data-section="inbox"]')?.textContent).toContain("新想法");
    expect(host.querySelector('[data-section="inbox"]')?.textContent).not.toContain("旧想法");
    expect(host.textContent).toContain("水下 1 条");
    await unmount(root);
  });

  it("does not let search bring sunken tasks into the default inbox", async () => {
    await addTask({ title: "旧想法 搜索词", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });

    const { host, root } = await renderPage();
    await waitForText(host, "水下 1 条");
    const input = host.querySelector('input[placeholder="做什么？怎样算做完…"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "搜索词");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushAsync();

    expect(host.querySelector('[data-section="inbox"]')?.textContent).not.toContain("旧想法 搜索词");
    await unmount(root);
  });

  it("bumps a sunken task so it returns to the inbox", async () => {
    await addTask({ title: "值得继续", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });
    const { host, root } = await renderPage();
    await waitForText(host, "水下 1 条");

    await openGravityReview(host);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="顶一下 值得继续"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForCondition(
      () => host.querySelector('[data-section="inbox"]')?.textContent?.includes("值得继续") ?? false,
      "bumped task to return to inbox",
    );
    await unmount(root);
  });

  it("advances the gravity waterline while the page stays mounted across days", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-01T12:00:00.000Z"));
    await addTask({ title: "会跨日下沉", toInbox: true, now: new Date("2026-06-01T12:00:00.000Z") });
    const { host, root } = await renderPage();
    await waitForText(host, "会跨日下沉");

    expect(host.querySelector('[data-section="inbox"]')?.textContent).toContain("会跨日下沉");

    dateNow.mockReturnValue(Date.parse("2026-06-20T00:00:00.000Z"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitForCondition(() => host.textContent?.includes("水下 1 条") ?? false, "waterline to advance");

    expect(host.querySelector('[data-section="inbox"]')?.textContent).not.toContain("会跨日下沉");
    expect(host.textContent).toContain("水下 1 条");
    await unmount(root);
  });

  // 回归：0702 审查 #1 —— 四分区曾用 useLiveQuery(..., []) 冻住时钟，跨日后「明天到期」不会掉进今天。
  // 修复前 listTasks 走默认参数 new Date()（不吃 Date.now spy），故本例必红；修复后走 gravityNow 才吃。
  it("跨日后四分区随 gravityNow 重算：明天的排期任务掉进今天", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    const task = await addTask({ title: "明天到期", toInbox: true });
    await scheduleTask(task.id, ymd);

    const { host, root } = await renderPage();
    await waitForText(host, "明天到期");
    expect((host.querySelector('[data-section="today"]') as HTMLElement | null)?.textContent ?? "").not.toContain(
      "明天到期",
    );

    const noonTomorrow = new Date(tomorrow);
    noonTomorrow.setHours(12, 0, 0, 0);
    vi.spyOn(Date, "now").mockReturnValue(noonTomorrow.getTime());
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitForCondition(
      () =>
        (host.querySelector('[data-section="today"]') as HTMLElement | null)?.textContent?.includes("明天到期") ??
        false,
      "scheduled task to fall into today after crossing midnight",
    );
    await unmount(root);
  });

  it("writes todo.gravity.review.v1 to settings on gravity review open without refreshing updatedAt", async () => {
    const t = await addTask({ title: "旧想法", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });
    const before = await db.tasks.get(t.id);
    const { host, root } = await renderPage();
    await waitForText(host, "水下 1 条");

    await openGravityReview(host);
    await flushAsync();

    const after = await db.tasks.get(t.id);
    expect(after?.updatedAt).toBe(before?.updatedAt);

    const reviewRaw = await getSetting("todo.gravity.review.v1");
    expect(reviewRaw).not.toBeNull();
    expect(reviewRaw).toContain(t.id);

    const logs = await db.syncLog.where("recordId").equals("todo.gravity.review.v1").toArray();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]).toMatchObject({ tableName: "settings" });
    await unmount(root);
  });

  it("shows sunken inbox tail after show-more in inbox", async () => {
    // 4 floating date groups + 1 sunken task（相对真实 now 取日期，避免写死日期随时间漂移出分组窗口）
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    await addTask({ title: "今天任务", toInbox: true, now: daysAgo(0) });
    await addTask({ title: "昨天任务", toInbox: true, now: daysAgo(1) });
    await addTask({ title: "前天任务", toInbox: true, now: daysAgo(2) });
    await addTask({ title: "更早任务", toInbox: true, now: daysAgo(3) });
    await addTask({ title: "沉没想法", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });

    const { host, root } = await renderPage();
    await waitForText(host, "今天任务");

    // 默认不显示水下列表
    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    expect(inbox.textContent).not.toContain("沉没想法");
    expect(inbox.textContent).not.toContain("水下 1 条");

    // 点击显示更多
    const moreBtn = inbox.querySelector('[aria-label^="显示更多"]') as HTMLButtonElement;
    expect(moreBtn).not.toBeNull();
    await act(async () => moreBtn.click());
    await flushAsync();

    // 尾部出现
    expect(inbox.textContent).toContain("水下 1 条");

    // 展开尾部
    const tailBtn = Array.from(inbox.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("水下 1 条"),
    ) as HTMLButtonElement;
    expect(tailBtn).toBeTruthy();
    await act(async () => tailBtn.click());
    await flushAsync();

    expect(inbox.textContent).toContain("沉没想法");
    await unmount(root);
  });

  it("shows sunken tail when floating groups <= 3 without show-more", async () => {
    await addTask({ title: "唯一浮起", toInbox: true });
    await addTask({ title: "沉没想法", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });

    const { host, root } = await renderPage();
    await waitForText(host, "唯一浮起");

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    // 无显示更多按钮
    expect(inbox.querySelector('[aria-label^="显示更多"]')).toBeNull();
    // 尾部直接可达
    expect(inbox.textContent).toContain("水下 1 条");
    await unmount(root);
  });

  it("shows sunken tail when all inbox tasks are underwater", async () => {
    await addTask({ title: "沉没想法", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });

    const { host, root } = await renderPage();
    await waitForText(host, "水下 1 条");

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    expect(inbox.querySelector('[aria-label^="显示更多"]')).toBeNull();
    const tailBtn = Array.from(inbox.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("水下 1 条"),
    ) as HTMLButtonElement;
    expect(tailBtn).toBeTruthy();

    await act(async () => tailBtn.click());
    await flushAsync();

    expect(inbox.textContent).toContain("沉没想法");
    await unmount(root);
  });

  it("search does not bring sunken tasks into default inbox but tail can show them", async () => {
    await addTask({ title: "浮起任务", toInbox: true });
    await addTask({ title: "沉没搜索词", toInbox: true, now: new Date("2000-01-01T00:00:00.000Z") });

    const { host, root } = await renderPage();
    await waitForText(host, "水下 1 条");

    // 搜索
    const input = host.querySelector('input[placeholder="做什么？怎样算做完…"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "搜索词");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushAsync();

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    // 搜索不把水下任务混入默认浮层
    expect(inbox.textContent).not.toContain("沉没搜索词");
    const tailBtn = Array.from(inbox.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("水下 1 条"),
    ) as HTMLButtonElement;
    expect(tailBtn).not.toBeNull();

    await act(async () => tailBtn.click());
    await flushAsync();

    expect(inbox.textContent).toContain("沉没搜索词");
    await unmount(root);
  });

  it("归属轴排他：项目成员离开收件箱，出现在项目区并带组名与计数", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    const member = await addTask({ title: "刷墙", toInbox: true });
    await addTask({ title: "自由任务", toInbox: true });
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: member.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });

    const { host, root } = await renderPage();
    await waitForCondition(() => {
      const zone = host.querySelector('[data-section="todo-projects"]') as HTMLElement | null;
      return (zone?.textContent ?? "").includes("刷墙");
    }, "project zone to list the member");

    const zone = host.querySelector('[data-section="todo-projects"]') as HTMLElement;
    expect(zone.textContent).toContain("装修");
    expect(zone.textContent).toContain("还剩 1 / 共 1");

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    expect(inbox.textContent ?? "").toContain("自由任务");
    expect(inbox.textContent ?? "").not.toContain("刷墙");
    await unmount(root);
  });

  it("拖起子任务时项目组块进禁止态，拖起根任务则是可落态（判定认 dnd 容器 id，不是查得到的行）", async () => {
    // 承重点：`dragDropBlocked` 的子任务那一支。子任务被 listTasks 整个跳过、不在任何 bucket 里，
    // 所以 `allTasks.find(...)` 恒查不到它——只能从 `parent:` 前缀的容器 id 认。这一支若退化，
    // 用户拖子任务到项目组就是全屏零反馈（TodoProjectSection.test.tsx 那两条只锁渲染，锁不住这里）。
    const now = "2026-06-28T09:00:00.000Z";
    const member = await addTask({ title: "刷墙", toInbox: true });
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: member.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });
    const parent = await addTask({ title: "父任务", toInbox: true });
    await createChildTask(parent.id, "子任务");

    const { host, root } = await renderPage();
    await waitForText(host, "父任务");

    const card = () => host.querySelector('[data-testid="project-group"][data-goal-id="g1"]');
    await waitForCondition(() => card() !== null, "project group card");
    expect(card()?.hasAttribute("data-drop-blocked")).toBe(false);

    // 展开父任务的子任务层（点左 2/5 抓取区），子任务行的拖柄才存在。
    const parentGrab = host.querySelector('[aria-label="移动 父任务"]') as HTMLElement;
    await act(async () => {
      parentGrab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForCondition(
      () => host.querySelector('[aria-label="拖动子任务 子任务"]') !== null,
      "child drag handle",
      settle,
    );

    // 键盘拖拽：MouseSensor 有 180ms 激活延迟（真实定时等待是禁的），KeyboardSensor 无延迟。
    const childHandle = host.querySelector('[aria-label="拖动子任务 子任务"]') as HTMLElement;
    await act(async () => {
      childHandle.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
    });
    expect(card()?.getAttribute("data-drop-blocked")).toBe("true");

    // Escape 结束这一拖，换根任务再来一次：同一个判定必须给出相反的答案，
    // 否则「恒 true」也能让上面那条断言绿。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true, cancelable: true }));
    });
    await waitForCondition(() => card()?.hasAttribute("data-drop-blocked") === false, "drag cancelled");

    const rootHandle = host.querySelector('[aria-label="移动 父任务"]') as HTMLElement;
    await act(async () => {
      rootHandle.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
    });
    expect(card()?.getAttribute("data-drop-blocked")).toBe("false");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true, cancelable: true }));
    });
    await unmount(root);
  });

  it("零 active project 时不渲染项目区，也不挂存量提示条", async () => {
    await addTask({ title: "自由任务", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "自由任务");
    expect(host.querySelector('[data-section="todo-projects"]')).toBeNull();
    expect(host.querySelector('[data-testid="project-zone-intro"]')).toBeNull();
    await unmount(root);
  });

  it("排到今天的项目成员在今天区显示项目名 chip，点它展开项目区对应组", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    // 提示条已读 → 项目区默认全折叠，才能观察到 chip 把它点开。
    setProjectZoneIntroDismissed(true);
    const member = await addTask({ title: "刷墙" });
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: member.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });

    const { host, root } = await renderPage();
    await waitForCondition(
      () => host.querySelector('[data-section="today"] [data-testid="project-name-chip"]') !== null,
      "project chip in today section",
    );

    const zone = host.querySelector('[data-section="todo-projects"]') as HTMLElement;
    expect(zone.textContent ?? "").not.toContain("刷墙");
    // 注：今天区的 <TaskColumn> 本就没接 goalLinkedIds（见下方「红线 3」用例的说明），
    // 这条用例只覆盖 chip 本身的展示与回跳，不覆盖竖条裁剪。

    const chip = host.querySelector('[data-section="today"] [data-testid="project-name-chip"]') as HTMLButtonElement;
    await act(async () => {
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flushAsync();
    expect((host.querySelector('[data-section="todo-projects"]') as HTMLElement).textContent ?? "").toContain("刷墙");
    await unmount(root);
  });

  it("今天区的项目成员点「回收件箱」：进不了收件箱，改为展开归属组并列出它", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    // 提示条已读 → 项目区默认全折叠。这正是「消失」的现场：排他让它进不了收件箱，
    // 没有 reveal 的话它只是落进上面那个折叠组，组 header 的「还剩 N / 共 M」纹丝不动，全屏零反馈。
    setProjectZoneIntroDismissed(true);
    const member = await addTask({ title: "刷墙" });
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: member.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });

    const { host, root } = await renderPage();
    await waitForCondition(
      () => host.querySelector('[data-section="today"] [aria-label="回收件箱 刷墙"]') !== null,
      "今天区行尾「回收件箱」动作",
    );
    expect((host.querySelector('[data-section="todo-projects"]') as HTMLElement).textContent ?? "").not.toContain(
      "刷墙",
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-section="today"] [aria-label="回收件箱 刷墙"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForCondition(() => {
      const zone = host.querySelector('[data-section="todo-projects"]') as HTMLElement | null;
      return (zone?.textContent ?? "").includes("刷墙");
    }, "项目区展开归属组并列出该成员");

    expect((host.querySelector('[data-section="today"]') as HTMLElement).textContent ?? "").not.toContain("刷墙");
    expect((host.querySelector('[data-section="inbox"]') as HTMLElement).textContent ?? "").not.toContain("刷墙");
    await unmount(root);
  });

  it("红线 3：被抓到手头的项目成员显示项目名 chip，且不与绿竖条同屏", async () => {
    // 手头区是唯一同时消费 goalLinkedIds 与 metaChip 的消费点（AtHandSection.tsx 两者都传给了 TaskRow）；
    // 今天区 / 已排期区当前接线里根本没传 goalLinkedIds 给对应组件，那两处的「无竖条」是恒真的，测了也白测——
    // 真正需要裁剪生效的断言只能立在这里。
    const now = "2026-06-28T09:00:00.000Z";
    const member = await addTask({ title: "刷墙", toInbox: true });
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: member.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });
    await grabTaskToHand(member.id, { now: new Date(now) });

    const { host, root } = await renderPage();
    await waitForCondition(
      () => host.querySelector('[data-section="todo-at-hand"] [data-testid="project-name-chip"]') !== null,
      "project chip in at-hand section",
    );

    const atHand = host.querySelector('[data-section="todo-at-hand"]') as HTMLElement;
    expect(atHand.querySelector('[data-testid="project-name-chip"]')?.textContent).toContain("装修");
    expect(atHand.querySelector('[data-testid="goal-linked-bar"]')).toBeNull();
    await unmount(root);
  });

  it("已完成区取消勾选：项目成员回落 inbox 池时展开归属组", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    // 提示条已读 → 项目区默认全折叠，才观察得到"被展开"这件事。
    setProjectZoneIntroDismissed(true);
    const member = await addTask({ title: "刷墙", toInbox: true });
    await toggleTaskDone(member.id);
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: member.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });

    const { host, root } = await renderPage();
    await waitForText(host, "刷墙");
    // 组是折叠的：项目区此时只显示组名与「已完成 · 1 条」，成员不在 DOM 里
    //（组体是条件渲染 `{expanded && ...}`，不是 <details>，所以 not.toContain 在这里有效）。
    const before = host.querySelector('[data-section="todo-projects"]') as HTMLElement;
    expect(before.textContent ?? "").toContain("装修");
    expect(before.textContent ?? "").not.toContain("刷墙");

    const checkbox = host.querySelector('input[aria-label="完成 刷墙"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox.click();
    });
    await waitForCondition(
      () =>
        ((host.querySelector('[data-section="todo-projects"]') as HTMLElement | null)?.textContent ?? "").includes(
          "刷墙",
        ),
      "project zone to expand the member's home group",
    );
    await unmount(root);
  });

  it("红线 4 反向：手头区「本场已完成」取消勾选，项目区不展开（它回的是手头，本来就看得见）", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    setProjectZoneIntroDismissed(true);
    const member = await addTask({ title: "刷墙", toInbox: true });
    await grabTaskToHand(member.id, { now: new Date(now) });
    await toggleTaskDone(member.id);
    await seedProjectGoal(member.id, now);

    const { host, root } = await renderPage();
    await waitForCondition(() => zoneText(host).includes("已完成 · 1 条"), "折叠的项目组");
    expect(zoneText(host)).not.toContain("刷墙");

    // 「本场已完成」是 <details open={false}>，子树仍在 DOM 里，不必展开就能点到这枚复选框。
    const checkbox = host.querySelector(
      '[data-section="todo-at-hand"] input[aria-label="完成 刷墙"]',
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox.click();
    });

    // 取消勾选后 listTasks 把它截进 atHand（焦点轴压过 placement），落到页面最顶上的手头区；
    // 此时展开项目区只会把页面滚走——这正是同批 releaseFromHand 亲手立的红线。
    await waitForCondition(() => zoneText(host).includes("还剩 1 / 共 1"), "组头计数回到未完成口径");
    expect(zoneText(host)).not.toContain("刷墙");
    expect((host.querySelector('[data-section="todo-at-hand"]') as HTMLElement).textContent ?? "").toContain("刷墙");
    await unmount(root);
  });

  it("详情抽屉清掉时间：项目成员回落 inbox 池，项目区展开归属组（抽屉→页面这根线）", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    setProjectZoneIntroDismissed(true);
    // 排到今天（addTask 的默认落点）：行落在今天区、点得开详情。排到远期会沉进已排期水下尾，点不到。
    const member = await addTask({ title: "刷墙" });
    await seedProjectGoal(member.id, now);

    const { host, root } = await renderPage();
    await waitForCondition(() => zoneText(host).includes("还剩 1 / 共 1"), "折叠的项目组");
    expect(zoneText(host)).not.toContain("刷墙");

    await openRecurrencePresets(host, "刷墙");
    await act(async () => {
      host.querySelector('button[aria-label="不重复"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForCondition(() => zoneText(host).includes("刷墙"), "项目区展开归属组", settle);
    await unmount(root);
  });

  it("详情抽屉清时间但任务已完成：不展开（落点是组内另一个折叠子区，展开了也看不到它）", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    setProjectZoneIntroDismissed(true);
    const member = await addTask({ title: "刷墙", toInbox: true });
    await scheduleTask(member.id, "2099-12-10");
    await toggleTaskDone(member.id);
    await seedProjectGoal(member.id, now);

    const { host, root } = await renderPage();
    await waitForCondition(() => zoneText(host).includes("已完成 · 1 条"), "折叠的项目组");
    expect(zoneText(host)).not.toContain("刷墙");

    await openRecurrencePresets(host, "刷墙");
    await act(async () => {
      host.querySelector('button[aria-label="不重复"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 写入确实落了（scheduledAt 被清成 null），但 done 没翻面：落点是「已完成」不是收件箱。
    await waitForTask(member.id, (task) => task?.scheduledAt === null);
    await settle();
    await settle();
    expect(zoneText(host)).toContain("已完成 · 1 条");
    expect(zoneText(host)).not.toContain("刷墙");
    await unmount(root);
  });

  it("详情抽屉选「仅某天」到未来日期：不展开（落点是已排期区，本来就看得见）", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    setProjectZoneIntroDismissed(true);
    const member = await addTask({ title: "刷墙" });
    await seedProjectGoal(member.id, now);

    const { host, root } = await renderPage();
    await waitForCondition(() => zoneText(host).includes("还剩 1 / 共 1"), "折叠的项目组");

    await openRecurrencePresets(host, "刷墙");
    await act(async () => {
      host.querySelector('button[aria-label="仅某天…"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    // 翻到下个月再挑最后一天：恒在未来，且不必替测试算时区（日期从月历自己的 aria-label 上读）。
    // 「仅某天」还能选过去的日期——那支才回落 inbox 池，靠 choice.kind === "none" 判会整个漏掉。
    const nextMonth = host.querySelector('section[aria-label="月历"] button[aria-label="下个月"]');
    expect(nextMonth).not.toBeNull();
    await act(async () => {
      nextMonth?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    const dayButtons = Array.from(host.querySelectorAll('section[aria-label="月历"] button[aria-pressed]'));
    const futureDay = dayButtons[dayButtons.length - 1] as HTMLButtonElement | undefined;
    const futureDate = futureDay?.getAttribute("aria-label") ?? "";
    expect(futureDate).not.toBe("");
    await act(async () => {
      futureDay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitForTask(member.id, (task) => task?.scheduledAt === normalizeScheduledDate(futureDate));
    await settle();
    await settle();
    expect(zoneText(host)).toContain("还剩 1 / 共 1");
    expect(zoneText(host)).not.toContain("刷墙");
    await unmount(root);
  });
});

describe("TodoPage occurrence 删除分流", () => {
  it("删除 pending occurrence：标记 skipped 留痕，不硬删", async () => {
    await db.tasks.add({
      id: "occ:r1:2026-06-14",
      parentId: null,
      title: "补铁",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: "2026-06-14T00:00:00.000Z",
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: "r1",
      skipped: false,
      sortOrder: 0,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    });

    const { host, root } = await renderPage();
    await waitForText(host, "补铁");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="删除 补铁"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForCondition(() => {
      const today = host.querySelector('[data-section="today"]') as HTMLElement | null;
      return !(today?.textContent?.includes("补铁") ?? false);
    }, "occurrence to leave today after skip");

    const stored = await db.tasks.get("occ:r1:2026-06-14");
    expect(stored).toMatchObject({ skipped: true });
    await expect(db.syncLog.where("recordId").equals("occ:r1:2026-06-14").toArray()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ tableName: "tasks", action: "update" })]),
    );
    await unmount(root);
  });

  it("删除混合体行（ruleId × recurrence 都非空）：走 cascade 兜底，不撞 markOccurrenceSkipped 前置校验", async () => {
    // 坏数据行：recurrence 非空让它落「已排期」，ruleId 非空则会被裸 `ruleId !== null` 误判成 occurrence。
    // markOccurrenceSkipped 的前置校验必抛，而列表侧删除是 fire-and-forget → 用户体感「点了没反应」。
    await db.tasks.add({
      id: "mixed-1",
      parentId: null,
      title: "混合体坏行",
      done: false,
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: "r9",
      skipped: false,
      sortOrder: 0,
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    });

    const { host, root } = await renderPage();
    await waitForText(host, "混合体坏行");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="删除 混合体坏行"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForCondition(() => !(host.textContent?.includes("混合体坏行") ?? false), "mixed row to leave the list");
    expect(await db.tasks.get("mixed-1")).toBeUndefined();
    await unmount(root);
  });
});
