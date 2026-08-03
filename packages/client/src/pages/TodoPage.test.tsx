// @vitest-environment jsdom
import "fake-indexeddb/auto";
import type { Task } from "@timedata/shared";
import { act, createElement, useEffect } from "react";
import { MemoryRouter, useLocation, useSearchParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNavProvider, useBottomNav } from "../contexts/BottomNavContext.js";
import { SyncProvider } from "../contexts/SyncContext.tsx";
import { db } from "../db/index.js";
import { grabTaskToHand } from "../lib/sessions.js";
import { getSetting } from "../lib/settings/index.js";
import { setTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import { addTask, createChildTask, deleteTaskCascade, scheduleTask, setTaskTags, toggleTaskDone } from "../lib/tasks.js";
import * as tasksLib from "../lib/tasks.js";
import { normalizeScheduledDate } from "../lib/tasks/placement.js";
import { setInboxCollapsed } from "../lib/tasks/workbenchPrefs.js";
import { promoteTaskToTrack, toggleTaskDoneWithTrackConclude } from "../lib/taskTrackPromote.js";
import { setTrackStatus } from "../lib/tracks.js";
import { click, renderDom, unmount } from "../test/domHarness.js";
import { TodoPage } from "./TodoPage.js";

beforeEach(async () => {
  localStorage.clear();
  vi.unstubAllGlobals();
  currentPathname = "/";
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

/**
 * 让用例在渲染之后改 URL 查询参数。用来模拟「多选态开着时来了一条 `?taskId=` 深链」
 *（通知点进来 / 应用内跳转），这是详情抽屉与多选态唯一能同屏共存的真实路径——
 * 多选态下行点击是勾选、其余区块 inert，页面内部开不出抽屉。
 */
let driveSearchParams: ((next: Record<string, string>) => void) | null = null;
let currentPathname = "/";
function SearchParamDriver() {
  const [, setSearchParams] = useSearchParams();
  driveSearchParams = (next) => setSearchParams(new URLSearchParams(next));
  return null;
}

function LocationDriver() {
  currentPathname = useLocation().pathname;
  return null;
}

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
      createElement(SearchParamDriver),
      createElement(LocationDriver),
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
  /** 轮询次数。默认 20 够绝大多数链路；只有规模异常的用例（500 成员的组）才该调大它。 */
  attempts = 20,
): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
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

function hasRemainingOne(text: string): boolean {
  return /还剩 1(?!\d)/.test(text);
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

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitInputByEnter(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await settle();
}

/**
 * 用键盘传感器完成一次「抓起 → 松手」的拖拽。
 *
 * 不用 MouseSensor：它有 180ms 激活延迟，而仓库禁真实定时等待。KeyboardSensor 无延迟，
 * 抓起与松手都是 Space。
 *
 * **落点为什么落在项目组**：键盘拖拽没有指针坐标（`pointerCoordinates` 恒 null），于是
 * `pointerWithin` 恒返回 `[]`，`preferProjectCollisions` 在这些用例里**一次都没生效**
 *（`projects.length === 0`，直接走 fallback）。真正定落点的是 `closestCenter`：jsdom 里所有 rect
 * 都是 (0,0,0,0)，全部距离并列，stable sort 保序，于是取 `droppableContainers` 里的第一名——
 * 那是**挂载顺序**（dnd-kit 用 Map 存，迭代走插入序），**不是 DOM 顺序**。
 *
 * 脆性边界（写明是为了让下一个人知道该怎么读红）：**任何**先挂载的 droppable 都会抢走落点，
 * 与它在 DOM 里的位置无关。在项目区之前新增 droppable（给某个分区加落点、给行加落点等）
 * 会让依赖本函数落进项目组的那几条用例**超时报红**——响亮失效，不会静默地把落点测成别的组。
 * 现有布置靠两件事把项目组顶到最前：① 初次渲染时今天区为空（被拖的行是渲染之后才挂上的）；
 * ② 只让目标那一组产出组卡，或让它按组间排序排在最前。
 */
async function keyboardDrag(handle: HTMLElement): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
  });
  await settle();
  await act(async () => {
    handle.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
  });
  await settle();
}

/** 等页面上出现某条操作反馈 toast。 */
async function waitForToast(host: HTMLElement, text: string): Promise<void> {
  await waitForCondition(
    () => (host.querySelector('[aria-label="待办操作反馈"]')?.textContent ?? "").includes(text),
    `toast ${text}`,
    settle,
  );
}

/** 进入多选：点收件箱标题右侧的「圈成项目」。 */
async function enterSelection(host: HTMLElement): Promise<void> {
  const entry = host.querySelector('[data-section="inbox"] [aria-label="圈成项目"]') as HTMLButtonElement;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flushAsync();
}

/** 多选态下点一行 = 勾选/取消勾选。 */
async function clickSelectRow(host: HTMLElement, title: string): Promise<void> {
  const row = host.querySelector(`[aria-label="选择 ${title}"]`) as HTMLElement;
  await act(async () => {
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flushAsync();
}

function selectionBar(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-testid="todo-selection-bar"]');
}

/**
 * 把这一条用例切到宽屏分支（`ResizableSplit`）。
 *
 * 默认 jsdom 的 `matchMedia().matches` 恒 false，整份文件都跑在窄屏 `flex flex-col` 上——
 * 于是「其余区块被 inert 挡住」只给窄屏那处包装上闸，宽屏那处漏了也不会红。
 * 两处布局必须同改，就得有一条用例站在另一边。
 */
function stubWideScreen(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width: 1024px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
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

  it("项目区跟随标签筛选并自动展开，只显示匹配成员", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    const match = await addTask({ title: "项目匹配", toInbox: true });
    await setTaskTags(match.id, ["工作"]);
    const other = await addTask({ title: "项目不匹配", toInbox: true });
    await setTaskTags(other.id, ["生活"]);
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [
        { kind: "task", id: match.id },
        { kind: "task", id: other.id },
      ],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });

    const { host, root } = await renderPage();
    await waitForCondition(() => host.querySelector('[data-testid="project-group"]') !== null, "project group");
    await click(host.querySelector('[aria-label="展开标签筛选"]'));
    await click(host.querySelector('[aria-label="筛选 工作"]'));
    await click(host.querySelector('[aria-label="收起标签筛选"]'));
    await waitForCondition(() => zoneText(host).includes("项目匹配"), "filtered project member");

    const zone = host.querySelector('[data-section="todo-projects"]') as HTMLElement;
    expect(zone.textContent).toContain("项目匹配");
    expect(zone.textContent).not.toContain("项目不匹配");
    expect(zone.querySelector('[data-testid="project-group-toggle"]')?.getAttribute("aria-expanded")).toBe("true");
    await unmount(root);
  });

  it("无项目时激活筛选仍不渲染项目区", async () => {
    await addTask({ title: "自由任务", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "自由任务");

    const input = host.querySelector('input[placeholder="做什么？怎样算做完…"]') as HTMLInputElement;
    await setInputValue(input, "自由");
    await flushAsync();
    expect(host.querySelector('[data-section="todo-projects"]')).toBeNull();
    await unmount(root);
  });

  it("存在 active project 但筛选后无匹配成员时显示项目区空态", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    const member = await addTask({ title: "项目成员", toInbox: true });
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
    await waitForCondition(() => host.querySelector('[data-testid="project-group"]') !== null, "project group");

    const input = host.querySelector('input[placeholder="做什么？怎样算做完…"]') as HTMLInputElement;
    await setInputValue(input, "完全不匹配");
    await waitForText(host, "项目区无匹配任务");

    expect(host.querySelector('[data-testid="todo-projects-empty"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="project-group"]')).toBeNull();
    await unmount(root);
  });

  it("筛选态项目内新建任务后提示当前筛选未显示该任务", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    const member = await addTask({ title: "已有成员", toInbox: true });
    await setTaskTags(member.id, ["工作"]);
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
    await waitForCondition(() => host.querySelector('button[aria-label="在项目 装修中创建任务"]') !== null, "project add button");
    await click(host.querySelector('[aria-label="展开标签筛选"]'));
    await click(host.querySelector('[aria-label="筛选 工作"]'));
    await click(host.querySelector('[aria-label="收起标签筛选"]'));
    await waitForCondition(() => zoneText(host).includes("已有成员"), "filtered project member");

    await click(host.querySelector('button[aria-label="在项目 装修中创建任务"]'));
    const input = host.querySelector('input[aria-label="在项目 装修中新建任务"]') as HTMLInputElement;
    await setInputValue(input, "筛选外任务");
    await submitInputByEnter(input);
    await waitForToast(host, "任务已创建，但当前筛选未显示它");
    expect((await db.tasks.toArray()).some((task) => task.title === "筛选外任务")).toBe(true);
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
    expect(collapse?.style.bottom).toBe("calc(4px + var(--safe-bottom))");

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
      return (zone?.textContent ?? "").includes("装修");
    }, "project zone to show the group");
    // 组默认全折叠（说明条退役后「首次全展开」一并去掉），成员行要展开才在 DOM 里。
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    await waitForCondition(() => {
      const zone = host.querySelector('[data-section="todo-projects"]') as HTMLElement | null;
      return (zone?.textContent ?? "").includes("刷墙");
    }, "project zone to list the member");

    const zone = host.querySelector('[data-section="todo-projects"]') as HTMLElement;
    expect(zone.textContent).toContain("装修");
    expect(hasRemainingOne(zone.textContent ?? "")).toBe(true);

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    expect(inbox.textContent ?? "").toContain("自由任务");
    expect(inbox.textContent ?? "").not.toContain("刷墙");
    await unmount(root);
  });

  it("项目组内加号创建任务：直接归入该组，不经过收件箱，也不产生成功 toast", async () => {
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

    const { host, root } = await renderPage();
    await waitForCondition(() => host.querySelector('button[aria-label="在项目 装修中创建任务"]') !== null, "project add button");
    await act(async () => {
      host.querySelector('button[aria-label="在项目 装修中创建任务"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const input = host.querySelector('input[aria-label="在项目 装修中新建任务"]') as HTMLInputElement;
    await setInputValue(input, "补漆");
    await submitInputByEnter(input);

    await waitForCondition(() => zoneText(host).includes("补漆"), "created project task", settle);
    const created = (await db.tasks.toArray()).find((task) => task.title === "补漆");
    expect(created?.scheduledAt).toBeNull();
    expect((await db.goals.get("g1"))?.members).toContainEqual({ kind: "task", id: created?.id });
    expect((host.querySelector('[data-section="inbox"]')?.textContent ?? "")).not.toContain("补漆");
    expect(host.querySelector('[aria-label="待办操作反馈"]')).toBeNull();
    await unmount(root);
  });

  it("项目组内创建撞 500：展示拒绝 toast，且不留下孤立任务", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    const member = await addTask({ title: "刷墙", toInbox: true });
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: member.id }, ...Array.from({ length: 499 }, (_, i) => ({ kind: "task" as const, id: `ghost-${i}` }))],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    });

    const { host, root } = await renderPage();
    await waitForCondition(() => host.querySelector('button[aria-label="在项目 装修中创建任务"]') !== null, "project add button");
    await act(async () => {
      host.querySelector('button[aria-label="在项目 装修中创建任务"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const input = host.querySelector('input[aria-label="在项目 装修中新建任务"]') as HTMLInputElement;
    await setInputValue(input, "超额任务");
    await submitInputByEnter(input);

    await waitForToast(host, "成员已满 500");
    expect((await db.tasks.toArray()).map((task) => task.title)).not.toContain("超额任务");
    expect((await db.goals.get("g1"))?.members).toHaveLength(500);
    await unmount(root);
  });

  it("项目更多菜单：改名走 updateGoal，打开跳到 goals 详情页", async () => {
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

    const { host, root } = await renderPage();
    await waitForCondition(() => host.querySelector('button[aria-label="项目 装修 更多操作"]') !== null, "project menu button");
    await act(async () => {
      host.querySelector('button[aria-label="项目 装修 更多操作"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      host.querySelector('[role="menuitem"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const renameInput = host.querySelector('input[aria-label="重命名项目 装修"]') as HTMLInputElement;
    await setInputValue(renameInput, "新装修");
    await submitInputByEnter(renameInput);
    await waitForCondition(() => zoneText(host).includes("新装修"), "goal rename rendered", settle);
    expect((await db.goals.get("g1"))?.title).toBe("新装修");

    await act(async () => {
      host.querySelector('button[aria-label="项目 装修 更多操作"], button[aria-label="项目 新装修 更多操作"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      host.querySelectorAll('[role="menuitem"]')[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await waitForCondition(() => currentPathname === "/goals/g1", "navigate to goal detail", settle);
    await unmount(root);
  });

  it("拖起子任务或重复待办时项目组块进禁止态，拖起根任务则是可落态", async () => {
    // `dragDropBlocked` 是两支各锁一半的判定，本例三段各打一支，删任一段另一支就裸奔：
    //  ① 子任务：被 listTasks 整个跳过、不在任何 bucket 里，`allTasks.find(...)` 恒查不到它，
    //     只能从 `parent:` 前缀的容器 id 认。
    //  ② 重复待办（occurrence）：它是根任务、容器 id 是 `pool:today`，容器那一支对它恒 false，
    //     只能由 `projectAssignBlock(task, 0) !== null` 认出来。
    //  ③ 普通根任务：必须给出相反答案，否则「恒 true」也能让前两段绿。
    // 任一支退化，用户往项目组拖就是全屏零反馈（TodoProjectSection.test.tsx 那条只锁渲染，锁不住这里）。
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
    // occurrence：ruleId 非空、recurrence 为 null、scheduledAt 落在今天 → placement 判 today，
    // 且 listTasks 只跳过 skipped 的 occurrence，所以它在今天区是真的可拖。取本地正午避开时区边界。
    const todayNoon = new Date();
    todayNoon.setHours(12, 0, 0, 0);
    await db.tasks.add({
      id: "occ:r1:today",
      parentId: null,
      title: "补铁",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: todayNoon.toISOString(),
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: "r1",
      skipped: false,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });

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
    await waitForCondition(() => card()?.hasAttribute("data-drop-blocked") === false, "second drag cancelled");

    // 第三段：重复待办。它从 `pool:today` 抓起，容器判定给不出 true，只能靠查行 + projectAssignBlock。
    await waitForCondition(() => host.querySelector('[aria-label="移动 补铁"]') !== null, "occurrence drag handle");
    const occurrenceHandle = host.querySelector('[aria-label="移动 补铁"]') as HTMLElement;
    await act(async () => {
      occurrenceHandle.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
    });
    expect(card()?.getAttribute("data-drop-blocked")).toBe("true");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true, cancelable: true }));
    });
    await unmount(root);
  });



  it("拖进项目组成功后弹一条「已归入」：组间排序键被刷新，目标组会跳到项目区第一位", async () => {
    // 成功路径刻意不展开组，但归入刷新成员 updatedAt、而组间排序键正是成员的 max(updatedAt)——
    // 目标组必然跳到第一位。不说出去向，连续拖第二条就会照着旧的视觉位置落进别的组，
    // 而且几乎不可见（组不展开、任务同时从收件箱消失）。
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
    const free = await addTask({ title: "自由任务", toInbox: true });

    const { host, root } = await renderPage();
    await waitForText(host, "自由任务");
    await keyboardDrag(host.querySelector('[aria-label="移动 自由任务"]') as HTMLElement);

    await waitForToast(host, "已归入「装修」");
    const goal = await db.goals.get("g1");
    expect(goal?.members).toContainEqual({ kind: "task", id: free.id });
    await unmount(root);
  });

  it("把子任务拖进项目组：给出拒绝原因，而不是「往这儿拖没反应」", async () => {
    // 承重点是 handleDragEnd 里 `if (!op)` 那段。它早退时 switch 里的 toast 一条也执行不到，
    // 而子任务→项目组恰好就走这条早退路径：resolveTodoDragOperation 对它返回 null。
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
    const child = await createChildTask(parent.id, "子任务");

    const { host, root } = await renderPage();
    await waitForText(host, "父任务");
    await act(async () => {
      (host.querySelector('[aria-label="移动 父任务"]') as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await waitForCondition(
      () => host.querySelector('[aria-label="拖动子任务 子任务"]') !== null,
      "child drag handle",
      settle,
    );

    await keyboardDrag(host.querySelector('[aria-label="拖动子任务 子任务"]') as HTMLElement);

    await waitForToast(host, "子任务不能单独归入项目");
    const goal = await db.goals.get("g1");
    expect(goal?.members).not.toContainEqual({ kind: "task", id: child.id });
    await unmount(root);
  });

  it("拖走带前置依赖的任务先问一句：取消则原样不动，确认才连边一起删", async () => {
    // 摘除成员必然删掉源组里引用它的 prerequisites 边（GoalSchema superRefine 的硬后果，改不掉）。
    // 以前这只发生在 goals 页的显式「退出项目」，现在待办页手滑一拖就触发、且成功不展开组，
    // 当场察觉不到。所以落库前先问一句。
    //
    // **布置为什么这么绕**：jsdom 里所有 rect 都是 (0,0,0,0)，closestCenter 全部并列，
    // dnd-kit 取先注册的那个 droppable。要让落点稳定是 gB，必须满足两件事：
    //   ① 初次渲染时今天区是空的（今天区在 DOM 里排在项目区前面，有行就会先注册、抢走落点）；
    //   ② gB 排在 gA 前面（组间按成员 max(updatedAt) 倒序），于是 gB 的卡先注册。
    // 被拖的 t1 是 gA 的成员，只有排进今天才可拖——所以它的今天行是**渲染之后**才挂上的，
    // 注册顺序排在两张组卡之后。
    const old = "2026-01-01T00:00:00.000Z";
    const newer = "2026-05-01T00:00:00.000Z";
    const t1 = await addTask({ title: "打地基", toInbox: true });
    const t2 = await addTask({ title: "砌墙", toInbox: true });
    const other = await addTask({ title: "别组成员", toInbox: true });
    await db.tasks.update(t1.id, { updatedAt: old });
    await db.tasks.update(t2.id, { updatedAt: old });
    await db.tasks.update(other.id, { updatedAt: newer });
    await db.goals.add({
      id: "gA",
      title: "老项目",
      kind: "project",
      status: "active",
      members: [
        { kind: "task", id: t1.id },
        { kind: "task", id: t2.id },
      ],
      prerequisites: [{ blocker: { kind: "task", id: t1.id }, blocked: { kind: "task", id: t2.id } }],
      createdAt: old,
      updatedAt: old,
    });
    await db.goals.add({
      id: "gB",
      title: "新项目",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: other.id }],
      prerequisites: [],
      createdAt: newer,
      updatedAt: newer,
    });

    const { host, root } = await renderPage();
    await waitForCondition(
      () => host.querySelectorAll('[data-testid="project-group"]').length === 2,
      "both project groups",
    );
    expect([...host.querySelectorAll("[data-goal-id]")].map((e) => e.getAttribute("data-goal-id"))).toEqual([
      "gB",
      "gA",
    ]);

    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    await scheduleTask(t1.id, ymd);
    await waitForCondition(
      () => host.querySelector('[aria-label="移动 打地基"]') !== null,
      "打地基 draggable in today",
      settle,
    );
    const grab = () => host.querySelector('[aria-label="移动 打地基"]') as HTMLElement;
    const dialogText = () => host.querySelector('[role="dialog"]')?.textContent ?? "";

    // ① 取消：一条边都不许掉，归属也不许动。
    await keyboardDrag(grab());
    await waitForCondition(() => dialogText().includes("移动会删掉依赖关系"), "confirm dialog", settle);
    // 整句匹配而不是片段：单组这句是唯一可以点名的那句，措辞漂了（或被多组那句顶掉）必须当场红。
    expect(dialogText()).toContain(
      "这条任务在「老项目」里有 1 条前置依赖关系。移到别的项目会一并删除，且无法撤销。",
    );
    await act(async () => {
      [...host.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.textContent === "取消")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect((await db.goals.get("gA"))?.members).toContainEqual({ kind: "task", id: t1.id });
    expect((await db.goals.get("gA"))?.prerequisites).toHaveLength(1);
    expect((await db.goals.get("gB"))?.members).not.toContainEqual({ kind: "task", id: t1.id });

    // ② 确认：归属换组，源组那条边随之消失——这正是要先问的那个后果。
    await keyboardDrag(grab());
    await waitForCondition(() => dialogText().includes("移动会删掉依赖关系"), "confirm dialog again", settle);
    await act(async () => {
      [...host.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.textContent === "仍要移动")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    let moved = false;
    for (let i = 0; i < 20 && !moved; i += 1) {
      await settle();
      moved = (await db.goals.get("gB"))?.members?.some((member) => member.id === t1.id) === true;
    }
    expect(moved).toBe(true);
    expect((await db.goals.get("gA"))?.members).not.toContainEqual({ kind: "task", id: t1.id });
    expect((await db.goals.get("gA"))?.prerequisites).toEqual([]);
    await unmount(root);
  });

  it("多个源组时确认弹窗只说组数与总条数，不把总数栽给某一个组名", async () => {
    // `count` 是全部源组之和，`goalTitle` 只是边最多的那一组。凑成「在「X」里有 N 条」就是在说假话：
    // 用户去 X 里数出来比 N 少，一次数不对就再也不信这个提示，往后一路无脑点「仍要移动」。
    //
    // 布置同上一条（今天区初次渲染为空 → 两张组卡先挂载 → 键盘拖拽落点稳定是排第一的 gB）。
    // 多出来的 gC 与 gA 争 t1/t2 的归属：projectMemberIndex 按 updatedAt 新者胜、并列取 id 小者，
    // 两组 updatedAt 都是 old → gA 全胜，gC 一个成员都投影不出来、**不产出组卡**，
    // 于是 droppable 的挂载顺序与上一条一字不差。而 prerequisiteLossOnAssign 读的是裸行、不看投影，
    // 照样把 gC 数进去——这正是"多源组"在真实数据里长的样子。
    const old = "2026-01-01T00:00:00.000Z";
    const newer = "2026-05-01T00:00:00.000Z";
    const t1 = await addTask({ title: "打地基", toInbox: true });
    const t2 = await addTask({ title: "砌墙", toInbox: true });
    const other = await addTask({ title: "别组成员", toInbox: true });
    await db.tasks.update(t1.id, { updatedAt: old });
    await db.tasks.update(t2.id, { updatedAt: old });
    await db.tasks.update(other.id, { updatedAt: newer });
    const pair = [
      { kind: "task", id: t1.id },
      { kind: "task", id: t2.id },
    ] as const;
    await db.goals.add({
      id: "gA",
      title: "老项目",
      kind: "project",
      status: "active",
      members: [...pair],
      // 1 条引用 t1
      prerequisites: [{ blocker: { kind: "task", id: t1.id }, blocked: { kind: "task", id: t2.id } }],
      createdAt: old,
      updatedAt: old,
    });
    await db.goals.add({
      id: "gC",
      title: "另一个老项目",
      kind: "project",
      status: "active",
      members: [...pair],
      // 2 条引用 t1（blocker 侧与 blocked 侧各一）——总数 3、边最多的组是 gC 而不是 gA
      prerequisites: [
        { blocker: { kind: "task", id: t1.id }, blocked: { kind: "task", id: t2.id } },
        { blocker: { kind: "task", id: t2.id }, blocked: { kind: "task", id: t1.id } },
      ],
      createdAt: old,
      updatedAt: old,
    });
    await db.goals.add({
      id: "gB",
      title: "新项目",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: other.id }],
      prerequisites: [],
      createdAt: newer,
      updatedAt: newer,
    });

    const { host, root } = await renderPage();
    await waitForCondition(
      () => host.querySelectorAll('[data-testid="project-group"]').length === 2,
      "both rendered project groups",
    );
    expect([...host.querySelectorAll("[data-goal-id]")].map((e) => e.getAttribute("data-goal-id"))).toEqual([
      "gB",
      "gA",
    ]);

    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    await scheduleTask(t1.id, ymd);
    await waitForCondition(
      () => host.querySelector('[aria-label="移动 打地基"]') !== null,
      "打地基 draggable in today",
      settle,
    );
    const dialogText = () => host.querySelector('[role="dialog"]')?.textContent ?? "";

    await keyboardDrag(host.querySelector('[aria-label="移动 打地基"]') as HTMLElement);
    await waitForCondition(() => dialogText().includes("移动会删掉依赖关系"), "confirm dialog", settle);

    expect(dialogText()).toContain(
      "这条任务在 2 个原项目里共有 3 条前置依赖关系。移到别的项目会一并删除，且无法撤销。",
    );
    // 反面：不许出现单组那句的任何点名说法（"在「gC」里有 3 条" 是用户数不出来的那个数）。
    expect(dialogText()).not.toContain("里有 3 条");

    await act(async () => {
      [...host.querySelectorAll('[role="dialog"] button')]
        .find((b) => b.textContent === "取消")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect((await db.goals.get("gB"))?.members).not.toContainEqual({ kind: "task", id: t1.id });
    await unmount(root);
  });

  it("零 active project 时不渲染项目区", async () => {
    await addTask({ title: "自由任务", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "自由任务");
    expect(host.querySelector('[data-section="todo-projects"]')).toBeNull();
    await unmount(root);
  });

  it("排到今天的项目成员在今天区显示项目名 chip，点它展开项目区对应组", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    // 项目区恒为默认全折叠，才能观察到 chip 把它点开。
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
    // 项目区恒为默认全折叠。这正是「消失」的现场：排他让它进不了收件箱，
    // 没有 reveal 的话它只是落进上面那个折叠组，组 header 的「还剩 N / 共 M」纹丝不动，全屏零反馈。
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
    // 项目区恒为默认全折叠，才观察得到"被展开"这件事。
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
    await waitForCondition(() => hasRemainingOne(zoneText(host)), "组头计数回到未完成口径");
    expect(zoneText(host)).not.toContain("刷墙");
    expect((host.querySelector('[data-section="todo-at-hand"]') as HTMLElement).textContent ?? "").toContain("刷墙");
    await unmount(root);
  });

  it("详情抽屉清掉时间：项目成员回落 inbox 池，项目区展开归属组（抽屉→页面这根线）", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    // 排到今天（addTask 的默认落点）：行落在今天区、点得开详情。排到远期会沉进已排期水下尾，点不到。
    const member = await addTask({ title: "刷墙" });
    await seedProjectGoal(member.id, now);

    const { host, root } = await renderPage();
    await waitForCondition(() => hasRemainingOne(zoneText(host)), "折叠的项目组");
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
    const member = await addTask({ title: "刷墙" });
    await seedProjectGoal(member.id, now);

    const { host, root } = await renderPage();
    await waitForCondition(() => hasRemainingOne(zoneText(host)), "折叠的项目组");

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
    expect(hasRemainingOne(zoneText(host))).toBe(true);
    expect(zoneText(host)).not.toContain("刷墙");
    await unmount(root);
  });

  it("行内勾掉挂轨道的任务 → 轨道自动归档", async () => {
    // beforeEach 不清 tracks/trackSteps，本用例开头自清，防上下文残留。
    await db.tracks.clear();
    await db.trackSteps.clear();
    const t = await addTask({ title: "长跑活" });
    await promoteTaskToTrack(t);

    const { host, root } = await renderPage();
    await waitForCondition(() => (host.textContent ?? "").includes("长跑活"), "挂轨道的任务行", settle);

    // 读侧整条缝（useTaskTrackIndex → TodoPage.trackChipFor → TaskRow.metaChip → TaskTrackChip）
    // 唯一的端到端断言：缺了它，trackChipFor 恒 return null、索引键写错、buildTaskTrackIndex 的两个
    // 同型 readonly string[] 实参对调、乃至删掉收件箱那个传点，都不会有任何测试变红。
    await waitForCondition(
      () => host.querySelector('[data-testid="task-track-chip"]') !== null,
      "行上轨道徽章",
      settle,
    );
    // 光板轨道无步骤 → 无信号 → 中性微标（data-tone="none"）。
    expect(host.querySelector('[data-testid="task-track-chip"]')?.getAttribute("data-tone")).toBe("none");

    await click(host.querySelector('input[aria-label="完成 长跑活"]'));
    // 归档链跨多段 IDB 事务（勾选事务 → listTracks → setTrackStatus），轮询等终态。
    let status: string | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      status = (await db.tracks.toArray())[0]?.status;
      if (status === "concluded") break;
      await settle();
    }
    expect(status).toBe("concluded");
    await unmount(root);
  });

  it("勾掉挂轨道的任务 → 弹带撤销的提示；点撤销把任务与轨道一起回退", async () => {
    await db.tracks.clear();
    await db.trackSteps.clear();
    const t = await addTask({ title: "手滑勾掉的活" });
    await promoteTaskToTrack(t);

    const { host, root } = await renderPage();
    await waitForCondition(() => (host.textContent ?? "").includes("手滑勾掉的活"), "挂轨道的任务行", settle);
    await click(host.querySelector('input[aria-label="完成 手滑勾掉的活"]'));

    // 归档静默发生的话屏幕上零痕迹——提示是它唯一的可见落点。
    await waitForCondition(() => (host.textContent ?? "").includes("已归档轨道"), "归档提示", settle);
    const undo = [...host.querySelectorAll("button")].find((b) => b.textContent === "撤销");
    expect(undo).toBeDefined();

    await click(undo);
    // 撤销是完整回退：任务回未完成 + 轨道重开 active。
    let reverted = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const task = await db.tasks.get(t.id);
      const track = (await db.tracks.toArray())[0];
      if (task?.done === false && track?.status === "active") {
        reverted = true;
        break;
      }
      await settle();
    }
    expect(reverted).toBe(true);
    await unmount(root);
  });

  it("轨道被手动重开后，已完成任务行仍显示轨道徽章（归档失败/重开态的唯一线索）", async () => {
    await db.tracks.clear();
    await db.trackSteps.clear();
    const t = await addTask({ title: "完了但轨道还开着" });
    const track = await promoteTaskToTrack(t);
    await toggleTaskDoneWithTrackConclude(t.id);
    // 模拟「归档失败」或用户去 /tracks 手动重新推进：任务 done，轨道却是 active。
    await setTrackStatus(track.id, "active");

    const { host, root } = await renderPage();
    await waitForCondition(() => (host.textContent ?? "").includes("完了但轨道还开着"), "已完成任务行", settle);
    // 若 trackChipFor 按 t.done 隐藏，这条唯一线索就没了，用户只能自己去 /tracks 撞见那条活轨道。
    await waitForCondition(
      () => host.querySelector('[data-testid="task-track-chip"]') !== null,
      "已完成行上的轨道徽章",
      settle,
    );
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

describe("TodoPage 多选态", () => {
  const COMPOSER_INPUT = 'input[placeholder="做什么？怎样算做完…"]';

  it("收件箱标题右侧的「圈成项目」进入多选，操作栏顶替记录框", async () => {
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");

    expect(selectionBar(host)).toBeNull();
    expect(host.querySelector(COMPOSER_INPUT)).not.toBeNull();

    await enterSelection(host);

    expect(selectionBar(host)?.textContent).toContain("已选 0 条");
    expect(host.querySelector(COMPOSER_INPUT)).toBeNull();
    await unmount(root);
  });

  it("零 active project 时入口仍常驻（冷启动）", async () => {
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");

    expect(host.querySelector('[data-section="todo-projects"]')).toBeNull();
    expect(host.querySelector('[data-section="inbox"] [aria-label="圈成项目"]')).not.toBeNull();
    await unmount(root);
  });

  it("点收件箱行会勾上，计数跟着变", async () => {
    await addTask({ title: "买灯", toInbox: true });
    await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);

    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");
    expect(selectionBar(host)?.textContent).toContain("已选 2 条");

    await clickSelectRow(host, "买灯");
    expect(selectionBar(host)?.textContent).toContain("已选 1 条");
    await unmount(root);
  });

  it("水下尾展开后的行也能选", async () => {
    // 沉水要同时过两道判据：`updatedAt` 老过水位线（默认 14 天）**且** `createdAt` 出了宽限期
    //（`isTaskInGracePeriod`，默认 7 天）。只改 updatedAt 的行还在宽限期里，永远浮着。
    // 用 addTask 的 now 一次把两个时间戳都写老，与本文件既有水下用例同口径。
    await addTask({ title: "陈年任务", toInbox: true, now: new Date("2025-06-28T09:00:00.000Z") });
    await addTask({ title: "新任务", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "新任务");
    await enterSelection(host);

    const inbox = host.querySelector('[data-section="inbox"]') as HTMLElement;
    const tailToggle = [...inbox.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").startsWith("水下"),
    ) as HTMLButtonElement;
    await act(async () => {
      tailToggle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flushAsync();

    await clickSelectRow(host, "陈年任务");
    expect(selectionBar(host)?.textContent).toContain("已选 1 条");
    await unmount(root);
  });

  it("重力翻牌区的行也能选（该区不被 inert 挡）", async () => {
    // 收件箱三处渲染点里最容易漏的一处：翻牌区走 GravityReviewSection 自己那份 TaskList，
    // 三个 selection prop 少透一个，这里就点不动，而其它两处照常工作、没人会发现。
    await addTask({ title: "水下陈年", toInbox: true, now: new Date("2025-06-28T09:00:00.000Z") });
    await addTask({ title: "新任务", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "新任务");
    await enterSelection(host);
    await openGravityReview(host);

    const review = host.querySelector('[data-section="todo-gravity-review"]') as HTMLElement;
    expect(review.closest("[inert]")).toBeNull();
    expect(review.querySelector('[aria-label="选择 水下陈年"]')).not.toBeNull();

    await clickSelectRow(host, "水下陈年");
    expect(selectionBar(host)?.textContent).toContain("已选 1 条");
    await unmount(root);
  });

  it("其余区块被 inert 挡住，收件箱不被挡", async () => {
    await addTask({ title: "今天的事" });
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "今天的事");
    await enterSelection(host);

    // 用 closest 而不是指名某个 wrapper：窄屏与宽屏两套布局各包一层，closest 两边都验得到。
    expect(host.querySelector('[data-section="today"]')?.closest("[inert]")).not.toBeNull();
    expect(host.querySelector('[data-section="inbox"]')?.closest("[inert]")).toBeNull();
    await unmount(root);
  });

  it("宽屏分支同样被 inert 挡住（两处布局各有一条闸）", async () => {
    // 与上一条同断言、只差屏幕：漏包窄屏或漏包宽屏各会红一条，两处同改的要求才真有闸。
    stubWideScreen();
    await addTask({ title: "今天的事" });
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "今天的事");
    // 探针：确认这条真的跑在宽屏分支上，否则它只是第二份窄屏用例。
    expect(host.querySelector('[aria-label="调整左右面板宽度"]')).not.toBeNull();
    await enterSelection(host);

    expect(host.querySelector('[data-section="today"]')?.closest("[inert]")).not.toBeNull();
    expect(host.querySelector('[data-section="inbox"]')?.closest("[inert]")).toBeNull();
    await unmount(root);
  });

  it("多选态下行右端的悬停动作条整条关掉，退出后回来", async () => {
    // 多选态下整行就是勾选命中区，用户自然会往右边点，指针正好压在「排进今天」上：任务离开收件箱
    // → 被剪枝踢出选中集（无任何提示）→ 落进一个 opacity-40 且 inert 的区块 → 多选态里再也弄不回来。
    // TaskList 关掉了拖拽（canSort）与滑动（blockSwipe），唯独这条动作条一直带电。
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    // 探针：jsdom 无 matchMedia → useIsCoarsePointer 为 false → 非多选态下动作条确实进了 DOM。
    // 没有这一行，下面的 toBeNull 在「动作条压根不渲染」的环境里也会绿。
    expect(host.querySelector('[aria-label="删除 买灯"]')).not.toBeNull();

    await enterSelection(host);
    expect(host.querySelector('[aria-label="删除 买灯"]')).toBeNull();
    expect(host.querySelector('[aria-label="排进今天 买灯"]')).toBeNull();
    expect(host.querySelector('[aria-label="抓到手头 买灯"]')).toBeNull();
    // 勾选照常：关的是动作条，不是这一行。
    await clickSelectRow(host, "买灯");
    expect(selectionBar(host)?.textContent).toContain("已选 1 条");

    await act(async () => {
      (host.querySelector('[aria-label="取消多选"]') as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsync();
    expect(host.querySelector('[aria-label="删除 买灯"]')).not.toBeNull();
    await unmount(root);
  });

  it("已勾选的行被删掉后从选中集剔除，操作栏不再多数一条", async () => {
    // 幽灵 id：`selectedIds` 只存 id，行被删后它照旧攥在手上。操作栏说「已选 2 条」而屏幕上只剩 1 行，
    // 提交时 `db.tasks.get(ghostId)` 拿不到人 → 抛裸 Error → 落进兜底文案 → 而失败刻意不退出多选，
    // 用户原地重试、每次都失败，屏幕上没有任何东西指向那个幽灵 id。
    await addTask({ title: "买灯", toInbox: true });
    await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    const doomed = (await db.tasks.toArray()).find((t) => t.title === "买灯");
    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");
    expect(selectionBar(host)?.textContent).toContain("已选 2 条");

    // 直接落库删，不点行右侧的垃圾桶：多选态下那条悬停动作条整条已经关掉（单条处置在这个模式里
    // 没有位置），页面内不再有删除手势。剩下的可达来源是**别的设备 / 别的标签页**同步下来一条删除，
    // liveQuery 照样回流——那正是幽灵 id 的真实出处（被抢走归属的那种，任务行还在库里，
    // `db.tasks.get` 拿得到人，是另一回事，已由「另一端把选中项收进项目组」那条守）。
    await act(async () => {
      await deleteTaskCascade(doomed?.id ?? "");
    });
    await waitForCondition(
      () => !((host.querySelector('[data-section="inbox"]') as HTMLElement).textContent ?? "").includes("买灯"),
      "买灯 离开收件箱",
      settle,
    );

    expect(selectionBar(host)?.textContent).toContain("已选 1 条");
    await unmount(root);
  });

  it("已勾选的行被勾完成后从选中集剔除（复选框在多选态里仍是「完成」）", async () => {
    // 同源的第二个现象：完成的行落进已完成区、离开收件箱，而操作栏照旧数着它。
    // 已完成任务本身**可以**当项目成员（design §投影规则 4），这条修的不是「不许收编已完成」，
    // 而是「操作栏别说谎、别把用户没在看的东西提交上去」。
    await addTask({ title: "买灯", toInbox: true });
    await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");
    expect(selectionBar(host)?.textContent).toContain("已选 2 条");

    const checkbox = host.querySelector('input[aria-label="完成 买灯"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox.click();
    });
    await waitForCondition(
      () => !((host.querySelector('[data-section="inbox"]') as HTMLElement).textContent ?? "").includes("买灯"),
      "买灯 落进已完成区",
      settle,
    );

    expect(selectionBar(host)?.textContent).toContain("已选 1 条");
    await unmount(root);
  });

  it("Esc 退出多选并清空选中", async () => {
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    expect(selectionBar(host)?.textContent).toContain("已选 1 条");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flushAsync();
    expect(selectionBar(host)).toBeNull();

    // 再进一次：选中集必须是空的，否则上一轮的勾选会跟着回来。
    await enterSelection(host);
    expect(selectionBar(host)?.textContent).toContain("已选 0 条");
    await unmount(root);
  });

  it("底栏被滚动隐藏时，toast 仍避开顶替记录框的操作栏", async () => {
    // 窄屏进多选后往下滚（多选本来就是给「要圈很多条」用的，滚动几乎必然发生）→ navHidden 为 true
    // → composerHiddenByScroll 为 true 且 navOffsetPx=0 → composerAvoidancePx 归零 → toast 落到
    // bottom:8px。但此刻 TodoComposer 根本没渲染，顶替它的 TodoSelectionBar **原地不动**、仍占着
    // 底部约 42px；两者同为 Z.backdrop(40) 而操作栏在 DOM 里排在 toast 容器之后 → 后绘制 → 完全遮住。
    // 多选态下 toast 是唯一的失败反馈通道（两种失败都不退出多选、只靠它说原因），压住就等于「点了没反应」。
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage({ hideBottomNav: true });
    await waitForText(host, "买灯");
    const dockBottom = () => {
      const raw = (host.querySelector('[data-testid="todo-toast-dock"]') as HTMLElement).style.bottom;
      const match = /^calc\((\d+)px \+ var\(--safe-bottom\)\)$/.exec(raw);
      return match ? Number.parseInt(match[1], 10) : Number.NaN;
    };

    // 探针：非多选态下记录框自己也被滚动藏起来了，底部真的空着，toast 贴底是对的。
    // 这一行同时钉死「本用例确实跑在 navHidden 分支上」——否则下面那条断言无论如何都会绿。
    const composerForm = (host.querySelector(COMPOSER_INPUT) as HTMLElement).closest("form") as HTMLElement;
    expect(composerForm.style.transform).toBe("translateY(100%)");
    expect(dockBottom()).toBe(8);

    await enterSelection(host);
    expect(selectionBar(host)).not.toBeNull();
    // 操作栏实测高约 42px（px-3 py-2 + 一行控件）。留不出这么多，toast 就在它底下。
    expect(dockBottom()).toBeGreaterThanOrEqual(42 + 8);
    await unmount(root);
  });

  it("有弹窗开着时 Esc 只关弹窗，多选态与选中集都不动", async () => {
    // 多选的 Esc 与 Sheet / TaskDetailSheet 的 Esc **都挂在 window 上、互不知情**：
    // 前者在 selectionMode 转 true 时先注册、后者在弹窗打开时后注册，同一次 keydown 两个都跑。
    // 用户想关弹窗，结果选了半天的那批一起没了——而退出后的页面和「成功建组」长得一模一样
    //（操作栏消失、记录框回来），只少一条 toast。
    const target = await addTask({ title: "买灯", toInbox: true });
    await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");
    expect(selectionBar(host)?.textContent).toContain("已选 2 条");

    await act(async () => {
      driveSearchParams?.({ taskId: target.id });
    });
    await settle();
    // 探针：抽屉真的开了才谈得上「让位」，否则这条只是又一遍「Esc 退出多选」。
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(selectionBar(host)).not.toBeNull();
    expect(selectionBar(host)?.textContent).toContain("已选 2 条");

    // 反向：弹窗关掉之后 Esc 必须重新生效，否则「让位」就成了「永久失灵」。
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flushAsync();
    expect(selectionBar(host)).toBeNull();
    await unmount(root);
  });

  it("收件箱折叠着进多选，顺带把它展开", async () => {
    // 「圈成项目」在 `<summary>` 里，与 `<details open>` 无关，折叠状态又是持久化的。
    // 折叠着点进去：全页其余区块变灰 inert + 底部「已选 0 条」操作栏，而收件箱还收着——
    // 一条可选行都看不见，第一眼是「模式坏了」。他点「圈成项目」就是要看收件箱，顺带展开。
    setInboxCollapsed(true);
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    const details = () => host.querySelector('[data-section="inbox"] details') as HTMLDetailsElement;
    // 探针：折叠偏好真的读进来了，而且点「圈成项目」不会因为 summary 的默认行为顺手展开
    //（CollapsibleSection 的 action 插槽 preventDefault 拦掉了那条路）。
    expect(details().open).toBe(false);

    await enterSelection(host);

    expect(details().open).toBe(true);
    expect(host.querySelector('[aria-label="选择 买灯"]')).not.toBeNull();
    await unmount(root);
  });

  it("会话内手动折叠收件箱后再进多选，照样展开", async () => {
    // 上一条走的是「折叠偏好在挂载前就存着」，那条路只需 defaultOpen 从 false 变 true。
    // 这一条是同一功能上真正会漏的那半：用户在页面里手动折叠——`onToggle` 只写 localStorage、
    // **不触发重渲染**，React 手上仍是上一次渲染的 `open={true}`，而 DOM 已经是 false。
    // 此时 enterSelection 再写一次 localStorage，下一帧算出的 defaultOpen 还是 true，
    // 与 React 记着的值相同 → 它认为没变、不碰 DOM → 收件箱还收着，修复形同虚设。
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    const details = () => host.querySelector('[data-section="inbox"] details') as HTMLDetailsElement;
    expect(details().open).toBe(true);

    // 浏览器点 summary 的形态：先改 DOM 的 open，再派发 toggle。
    await act(async () => {
      details().open = false;
      details().dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(details().open).toBe(false);

    await enterSelection(host);

    expect(details().open).toBe(true);
    await unmount(root);
  });

  it("进出多选不重挂项目区，用户展开的组保持展开", async () => {
    // `dimWhenSelecting` 在同一插槽位置返回 `node` 或 `<div inert>{node}</div>`——元素类型变了，
    // React 卸载重挂，`TodoProjectSection` 的展开态 overrides（组件本地 state）随之清空。
    // 建组成功后尤其明显：新组按 reveal 展开并滚过去，而用户此前展开的其它组全部收回去，
    // 「展开新组」的反馈被「其余全塌」的布局跳动淹掉。
    const seedMember = await addTask({ title: "刷墙", toInbox: true });
    await seedProjectGoal(seedMember.id);
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await waitForCondition(() => zoneText(host).includes("装修"), "项目区出现「装修」", settle);

    const toggle = () => host.querySelector('[data-testid="project-group-toggle"]') as HTMLButtonElement;
    // 探针：默认全折叠，下面那次点击才真的是「用户手动展开」。
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      toggle().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flushAsync();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");

    await enterSelection(host);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      (host.querySelector('[aria-label="取消多选"]') as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsync();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await unmount(root);
  });

  it("没有内容的区块，包装层不含任何节点（靠 empty:hidden 不占 flex 子项）", async () => {
    // 恒定包一层是上一条的修法，代价是空区块（没有已完成任务时 `completedBlock` 就是 `false`）
    // 也会多出一个 flex 子项，`gap-4` 里凭空多 16px。靠 Tailwind 的 `empty:hidden`（`:empty` 伪类）
    // 消掉——前提是那个包装层里**一个节点都没有**：塞进任何占位内容（哪怕一段空白文本）
    // `:empty` 就不匹配，间距会静默回来，而 jsdom 里没有 CSS、断言不到 display。
    // 故这里守的是那个前提，CSS 那一半由 Tailwind 构建产物验证（见提交说明）。
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");

    const column = host.querySelector(".flex.flex-col.gap-4") as HTMLElement;
    expect(column).not.toBeNull();
    const blanks = [...column.children].filter((el) => el.matches(":empty"));
    // 已完成区没有任务 → 至少有它一个空包装层。
    expect(blanks.length).toBeGreaterThan(0);
    for (const blank of blanks) expect(blank.classList.contains("empty:hidden")).toBe(true);
    await unmount(root);
  });

  it("点取消退出多选，记录框回来", async () => {
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);

    await act(async () => {
      (host.querySelector('[aria-label="取消多选"]') as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await flushAsync();

    expect(selectionBar(host)).toBeNull();
    expect(host.querySelector(COMPOSER_INPUT)).not.toBeNull();
    await unmount(root);
  });
});

describe("TodoPage 多选提交", () => {
  async function clickByLabel(host: HTMLElement, label: string): Promise<void> {
    const el = host.querySelector(`[aria-label="${label}"]`) as HTMLElement;
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await flushAsync();
  }

  async function typeProjectName(host: HTMLElement, value: string): Promise<void> {
    const input = host.querySelector('[aria-label="项目名"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushAsync();
  }

  const dialogText = (host: HTMLElement) => host.querySelector('[role="dialog"]')?.textContent ?? "";

  /**
   * 跨设备并发的存量形态：**选中之后**这批任务才被另一端写进某 active project 的 members。
   *
   * 顺序不能反。归属轴排他（`listTasks` 里的 `ownedByProject`）保证 active project 的成员
   * **永远不出现在收件箱**，"既在 members 里又还显示在收件箱"那种行根本构造不出来——
   * 先 seed 再进多选的话连 `选择 X` 那一行都查不到，用例会死在 null 上而不是测到东西。
   * 真正可达的是这一条：多选态开着的时候 sync 拉下一份新的 goals 行，而 `selectedIds` 只存 id、
   * 没有任何剪枝，那批任务照旧攥在手上，提交时才撞上前置边。
   */
  async function seedStaleMembership(t1Id: string, t2Id: string): Promise<void> {
    await db.goals.add({
      id: "gA",
      title: "旧组",
      kind: "project",
      status: "active",
      members: [
        { kind: "task", id: t1Id },
        { kind: "task", id: t2Id },
      ],
      prerequisites: [{ blocker: { kind: "task", id: t1Id }, blocked: { kind: "task", id: t2Id } }],
      createdAt: "2026-06-28T09:00:00.000Z",
      updatedAt: "2026-06-28T09:00:00.000Z",
    });
  }

  it("建组成功：退出多选、展开新组、弹提示", async () => {
    // 项目区恒为默认全折叠，所以「新组是展开的」不会被默认展开顶成假绿。
    await addTask({ title: "买灯", toInbox: true });
    await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");

    await typeProjectName(host, "装修");
    await clickByLabel(host, "圈成项目");
    await waitForToast(host, "已建「装修」· 2 条");

    expect(selectionBar(host)).toBeNull();
    await waitForCondition(() => zoneText(host).includes("买灯"), "新组展开并列出成员", settle);
    expect(zoneText(host)).toContain("装修");
    expect((host.querySelector('[data-section="inbox"]') as HTMLElement).textContent ?? "").not.toContain("买灯");
    await unmount(root);
  });

  it("勾选后又删掉一条，整批照常提交（不再被幽灵 id 卡死）", async () => {
    // 剪枝之前这条走的是死路：`assignTasksToProject`/`createProjectWithMembers` 里
    // `db.tasks.get(ghostId)` 返回 undefined → 抛裸 `Error("任务不存在")`（不是 ProjectAssignError）
    // → 兜底文案「…数据有问题…」→ 而失败不退出多选，用户原地重试，每次都失败。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await addTask({ title: "买灯", toInbox: true });
    await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    const doomed = (await db.tasks.toArray()).find((t) => t.title === "买灯");
    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");

    // 直接落库删（同步下来的删除），不点垃圾桶：多选态下悬停动作条整条已关掉。理由同上一条用例。
    await act(async () => {
      await deleteTaskCascade(doomed?.id ?? "");
    });
    await waitForCondition(
      () => !((host.querySelector('[data-section="inbox"]') as HTMLElement).textContent ?? "").includes("买灯"),
      "买灯 离开收件箱",
      settle,
    );

    await typeProjectName(host, "装修");
    await clickByLabel(host, "圈成项目");

    await waitForToast(host, "已建「装修」· 1 条");
    expect(selectionBar(host)).toBeNull();
    const goal = (await db.goals.toArray()).find((g) => g.title === "装修");
    expect(goal?.members).toHaveLength(1);
    // 兜底 catch 一次都不该进：进了就说明这条只是"换了个方式失败"。
    // 按前缀挑而不是 `not.toHaveBeenCalled()`：React 的 act 警告也走 console.error，
    // 整体断言会被它顶成红，测的就不再是这条链路了。
    expect(errorSpy.mock.calls.filter((call) => String(call[0]).includes("多选提交失败"))).toHaveLength(0);
    await unmount(root);
  });

  it("在项目名输入框里按住回车，只建出一个项目", async () => {
    // 最容易撞上的不是鼠标双击，是**按住回车**：onKeyDown 对每一次 keydown（含系统自动重复，
    // 约 30ms 一发）都调一次 submitCreate()，而 `disabled={!canCreate}` 只看有没有选中 + 有没有
    // 名字，提交期间两者都还成立。后果是两个同名 goal，第二个的 assignTasksToProject 把成员从
    // 第一个摘走，留下一个**成员为 0 的空壳项目** + 一条推给别的设备的 goals create 同步日志。
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await typeProjectName(host, "装修");

    const input = host.querySelector('[aria-label="项目名"]') as HTMLInputElement;
    // 两发 keydown 必须在**同一个 tick 里连发**，中间不 await：这正是自动重复的形态，
    // 也是在途闸唯一挡得住而 disabled 挡不住的窗口。分两次 act 的话第一次早就跑完了。
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await waitForToast(host, "已建「装修」· 1 条");
    await settle();

    const created = (await db.goals.toArray()).filter((goal) => goal.title === "装修");
    expect(created).toHaveLength(1);
    expect(created[0]?.members).toHaveLength(1);
    // 同步日志同样只能有一条 create，否则别的设备也会收到那个空壳。
    const createLogs = (await db.syncLog.toArray()).filter(
      (log) => log.tableName === "goals" && log.action === "create",
    );
    expect(createLogs).toHaveLength(1);
    await unmount(root);
  });

  it("提交失败后在途闸要放开，原地重试仍能提交", async () => {
    // 失败刻意不退出多选，就是为了让用户原地重试（见 reportSubmitFailure）。闸若不在 finally 里
    // 放开，重试就永远点不动，而屏幕上没有任何东西说明为什么——比原来的重复提交更糟。
    //
    // 走「放进…」这一侧，让共用的在途闸在**两个调用点**上都被踩过：另一条（按住回车）在
    // submitCreateProject 上。「放进…」自己的并发后果反而看不见——addGoalMember 对已在组内的
    // 成员整个 return、连 syncLog 都不写，所以第二发是彻底的 no-op，那种用例是假闸。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seedMember = await addTask({ title: "刷墙", toInbox: true });
    await seedProjectGoal(seedMember.id);
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");

    // 只坏一次：addGoalMember 写目标组走的就是这一步。
    vi.spyOn(db.goals, "put").mockRejectedValueOnce(new Error("写库失败"));
    await clickByLabel(host, "放进已有项目");
    await clickByLabel(host, "放进 装修");
    await waitForToast(host, "暂时移不过去");
    expect(errorSpy).toHaveBeenCalled();
    expect(selectionBar(host)).not.toBeNull();

    // 重试要先把列表再点开：选完一个组列表就收起了（让出被它盖住的失败 toast，
    // 见 TodoSelectionBar 的 onClick）。这一步本身也是那条修复的连带闸——列表若没收，这里会红。
    await clickByLabel(host, "放进已有项目");
    await clickByLabel(host, "放进 装修");
    await waitForToast(host, "已归入「装修」· 1 条");
    expect((await db.goals.get("g1"))?.members).toHaveLength(2);
    await unmount(root);
  });

  it("批量归入成功：退出多选、展开目标组、弹提示", async () => {
    const seedMember = await addTask({ title: "刷墙", toInbox: true });
    await seedProjectGoal(seedMember.id);
    await addTask({ title: "买灯", toInbox: true });
    await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");

    await clickByLabel(host, "放进已有项目");
    await clickByLabel(host, "放进 装修");
    await waitForToast(host, "已归入「装修」· 2 条");

    expect(selectionBar(host)).toBeNull();
    await waitForCondition(() => zoneText(host).includes("买灯"), "目标组展开并列出新成员", settle);
    await unmount(root);
  });

  it("目标组满员：说出原因，且留在多选态", async () => {
    // 500 个**真实存在**的成员，不能用悬空 ref 凑数：查不到任务的 ref 不进项目区投影，
    // 那个组连组卡都不产出、`selectableProjects` 里也没有它，「放进 装修」按钮根本不存在。
    // 每行照 TaskSchema 的形态写全（含 `ruleId: null`）：listTasks 主循环前对每行做
    // `TaskSchema.safeParse`，parse 不过的行被整条丢弃，同样会让这 500 个成员一个都投影不出来。
    const filler = Array.from({ length: 500 }, (_, i) => ({
      id: `filler-${i}`,
      parentId: null,
      title: `填充 ${i}`,
      done: false,
      recurrence: null,
      ruleId: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      completedAt: null,
      tags: [],
      sortOrder: i,
      createdAt: "2026-06-28T09:00:00.000Z",
      updatedAt: "2026-06-28T09:00:00.000Z",
    }));
    await db.tasks.bulkAdd(filler);
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: filler.map((task) => ({ kind: "task" as const, id: task.id })),
      prerequisites: [],
      createdAt: "2026-06-28T09:00:00.000Z",
      updatedAt: "2026-06-28T09:00:00.000Z",
    });
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    // 探针：500 条 filler 必须全归项目区、收件箱只剩「买灯」。它们要是涌进收件箱，
    // 「放进 装修」照样点得动、toast 照样出，但这条用例测的就不再是满员那道闸了。
    expect((host.querySelector('[data-section="inbox"]') as HTMLElement).textContent ?? "").not.toContain("填充 0");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");

    await clickByLabel(host, "放进已有项目");
    await clickByLabel(host, "放进 装修");

    // 轮询预算放到 120 次：500 个成员的组每转一轮都很贵（成员数组的结构化克隆 + 整组重渲染），
    // 从点击到 toast 实测要 49 个宏任务，而共用的 waitForToast 只轮 20 次。
    // 这不是"等一个不会发生的事"——同一条链路在 3 个成员的组上只要 9 次，纯粹是规模代价。
    await waitForCondition(
      () => (host.querySelector('[aria-label="待办操作反馈"]')?.textContent ?? "").includes("的成员已满 500"),
      "满员 toast",
      settle,
      120,
    );
    // 留在多选态：选了半天的那批还在手上，退出等于让用户重选一遍。
    expect(selectionBar(host)).not.toBeNull();
    await unmount(root);
  });

  /**
   * ⚠️ 这三条原本测的是「批量路径上的前置边确认框」（弹出/取消不写/确认写入/`nextGoalId` 不能传 null）。
   * `selectedIds` 开始跟着收件箱剪枝之后，那个确认框在批量路径上**不再可达**，原构造整体失效：
   *
   *   `listTasks` 的归属轴排他判据是 `row.status === "active" && row.kind === "project"`；
   *   `prerequisiteLossOnAssignMany` 的取源判据**逐字相同**。于是「选中项带 project 归属」
   *   与「选中项还在收件箱里（= 还在选中集里）」互斥，前置边一条都数不出来。
   *
   * 确认框的调用保留着当保险（判据将来若放宽，它立刻重新生效），但它的承重测试必须下沉到
   * `lib/goals` 的 `prerequisiteLossOnAssignMany` 一侧——那是另一轮的事。
   * 这三条换成剪枝自己的承重：被另一端抢走的选中项退出选中集，且**不替用户去动它原来的组**。
   */
  it("另一端把选中项收进项目组后，它退出选中集，原组一个字都不动", async () => {
    // 剪枝前这里是一条静默的破坏路径：买灯 已经不在收件箱、屏幕上看不到它被选中，
    // 而提交会把它从「旧组」摘走、连带删掉那条前置边——用户从没碰过「旧组」。
    const t1 = await addTask({ title: "买灯", toInbox: true });
    const t2 = await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    // 归属在选完之后才落地——顺序的理由见 seedStaleMembership 的注释。
    await seedStaleMembership(t1.id, t2.id);
    await waitForCondition(() => zoneText(host).includes("旧组"), "旧组进项目区", settle);
    expect(selectionBar(host)?.textContent).toContain("已选 0 条");

    // 选中集空了，「圈成项目」随之禁用；点它（以及走 Enter）都该是彻底的 no-op。
    await typeProjectName(host, "新组");
    await clickByLabel(host, "圈成项目");
    await settle();

    expect(dialogText(host)).toBe("");
    expect((await db.goals.toArray()).map((g) => g.title)).toEqual(["旧组"]);
    expect((await db.goals.get("gA"))?.prerequisites).toHaveLength(1);
    // 留在多选态：什么都没提交，没有理由把用户踢出去。
    expect(selectionBar(host)).not.toBeNull();
    await unmount(root);
  });

  it("只被抢走一条时，剩下那条照常建组，原组不受影响", async () => {
    // 剪枝必须是**逐条**的，不是「一有幽灵就整批放弃」：那样一条 sync 就能让用户重选一遍。
    await addTask({ title: "买灯", toInbox: true });
    const t2 = await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");
    expect(selectionBar(host)?.textContent).toContain("已选 2 条");

    await act(async () => {
      await db.goals.add({
        id: "gA",
        title: "旧组",
        kind: "project",
        status: "active",
        members: [{ kind: "task", id: t2.id }],
        prerequisites: [],
        createdAt: "2026-06-28T09:00:00.000Z",
        updatedAt: "2026-06-28T09:00:00.000Z",
      });
    });
    await waitForCondition(() => zoneText(host).includes("旧组"), "旧组进项目区", settle);
    expect(selectionBar(host)?.textContent).toContain("已选 1 条");

    await typeProjectName(host, "装修");
    await clickByLabel(host, "圈成项目");
    await waitForToast(host, "已建「装修」· 1 条");

    const created = (await db.goals.toArray()).find((g) => g.title === "装修");
    expect(created?.members).toEqual([{ kind: "task", id: (await db.tasks.toArray()).find((t) => t.title === "买灯")?.id }]);
    // 「旧组」既没被摘成员也没被改：它从头到尾不该参与这次提交。
    expect((await db.goals.get("gA"))?.members).toEqual([{ kind: "task", id: t2.id }]);
    await unmount(root);
  });

  it("「放进…」路径同样剪枝：被抢走的那条不算进提交", async () => {
    // 两条提交路径各自读 `selectedIds`，剪枝只在一处生效是可能的手误——归入这侧要有自己的闸。
    const seedMember = await addTask({ title: "刷墙", toInbox: true });
    await seedProjectGoal(seedMember.id);
    await addTask({ title: "买灯", toInbox: true });
    const t2 = await addTask({ title: "买椅子", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买椅子");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await clickSelectRow(host, "买椅子");
    expect(selectionBar(host)?.textContent).toContain("已选 2 条");

    await act(async () => {
      await db.goals.add({
        id: "gA",
        title: "旧组",
        kind: "project",
        status: "active",
        members: [{ kind: "task", id: t2.id }],
        prerequisites: [],
        createdAt: "2026-06-28T09:00:00.000Z",
        updatedAt: "2026-06-28T09:00:00.000Z",
      });
    });
    await waitForCondition(() => zoneText(host).includes("旧组"), "旧组进项目区", settle);
    expect(selectionBar(host)?.textContent).toContain("已选 1 条");

    await clickByLabel(host, "放进已有项目");
    await clickByLabel(host, "放进 装修");
    await waitForToast(host, "已归入「装修」· 1 条");

    expect((await db.goals.get("gA"))?.members).toEqual([{ kind: "task", id: t2.id }]);
    await unmount(root);
  });

  it("非预期错误：兜底提示 + console.error，不吞掉、不退出多选", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seedMember = await addTask({ title: "刷墙", toInbox: true });
    // 重复 ref 的裸行：读侧照常渲染成落点（红线 3），但 addGoalMember 内部的 GoalSchema.parse
    // 会被 superRefine 拒掉 —— 这是用户可达且会永远复现的一类非 ProjectAssignError。
    await db.goals.add({
      id: "g1",
      title: "装修",
      kind: "project",
      status: "active",
      members: [
        { kind: "task", id: seedMember.id },
        { kind: "task", id: seedMember.id },
      ],
      prerequisites: [],
      createdAt: "2026-06-28T09:00:00.000Z",
      updatedAt: "2026-06-28T09:00:00.000Z",
    });
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await clickByLabel(host, "放进已有项目");
    await clickByLabel(host, "放进 装修");

    await waitForToast(host, "暂时移不过去");
    expect(errorSpy).toHaveBeenCalled();
    expect(selectionBar(host)).not.toBeNull();
    await unmount(root);
  });

  /**
   * `confirmPrerequisiteLoss` 里第一句就是 `db.goals.toArray()`（见 `prerequisiteLossOnAssignMany`）。
   * DatabaseClosed / 版本升级期它会 reject，而调用点是 `void submitCreateProject(...)`——
   * 这句要是留在 try 之外，既不进 `reportSubmitFailure` 也没人接这个 rejection：
   * 静默无反馈 + unhandled rejection。两条提交路径各写一条，只修一边是这轮已经犯过的手误。
   */
  function breakPrerequisiteScan(): void {
    vi.spyOn(db.goals, "toArray").mockRejectedValueOnce(new Error("DatabaseClosed"));
  }

  it("建组时查前置边就 reject：走兜底 toast，不静默、不留 unhandled rejection", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await typeProjectName(host, "装修");

    // 紧贴着点击装 mock：中间不 await，免得被某次 liveQuery 回流的 listTasks 抢先消费掉这一发。
    breakPrerequisiteScan();
    await clickByLabel(host, "圈成项目");

    await waitForToast(host, "暂时建不了组");
    expect(errorSpy).toHaveBeenCalled();
    // 什么都没写，且留在多选态让用户原地重试。
    expect(await db.goals.toArray()).toHaveLength(0);
    expect(selectionBar(host)).not.toBeNull();
    await unmount(root);
  });

  it("归入时查前置边就 reject：同样走兜底 toast", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seedMember = await addTask({ title: "刷墙", toInbox: true });
    await seedProjectGoal(seedMember.id);
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");
    await clickByLabel(host, "放进已有项目");

    breakPrerequisiteScan();
    await clickByLabel(host, "放进 装修");

    await waitForToast(host, "暂时移不过去");
    expect(errorSpy).toHaveBeenCalled();
    expect((await db.goals.get("g1"))?.members).toHaveLength(1);
    expect(selectionBar(host)).not.toBeNull();
    await unmount(root);
  });

  it("归入失败时组列表已收起，失败 toast 露得出来", async () => {
    // 操作栏与 toast dock 同为 z-backdrop，操作栏在 DOM 里排其后 → 后绘制的它（含向上展开的
    // 「放进…」列表）赢。实测几何：toast 占 101…141，操作栏顶边 95、列表占 103…140——
    // 列表开着就把 toast 整条盖死。而归入失败刻意不退出多选、toast 是唯一的失败反馈通道，
    // 列表又只由用户点「放进…」切换、不会自动收，等他合上列表 toast 早已到点消失。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seedMember = await addTask({ title: "刷墙", toInbox: true });
    await seedProjectGoal(seedMember.id);
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");

    vi.spyOn(db.goals, "put").mockRejectedValueOnce(new Error("写库失败"));
    await clickByLabel(host, "放进已有项目");
    // 探针：列表真的开过，否则「已收起」是白捡的绿。
    expect(host.querySelector('[aria-label="放进 装修"]')).not.toBeNull();
    await clickByLabel(host, "放进 装修");

    await waitForToast(host, "暂时移不过去");
    expect(host.querySelector('[aria-label="放进 装修"]')).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    await unmount(root);
  });

  it("建组时源组数据损坏：兜底文案说的是「建不了组」，且留在多选态", async () => {
    // 建组侧的 catch 分支此前完全裸奔：上面那条走的是归入路径，所以「留在多选态」与兜底文案
    // 这两个断言只覆盖了 submitAssignToProject 一侧。实测过——在 submitCreateProject 的 catch 里
    // 顺手加一句 exitSelection()（一个看着更"干净"的手误），整套 57 条用例一条都不会红。
    //
    // 原构造（另一端 sync 下来一份含选中任务的坏组）随 selectedIds 剪枝一起失效了：
    // 那条任务一旦带上 active project 归属就离开收件箱、被剪出选中集，提交根本不会发生。
    // 理由与上面三条同源，见那段 ⚠️ 注释。
    //
    // 换成在写库那一步注入失败：这条用例守的本来就是**页面的失败出口**（兜底文案 + 不退出多选），
    // 不是数据层为什么会抛。`createProjectWithMembers` 里 `db.goals.add(seed)` 是这条链上的第一次写。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await addTask({ title: "买灯", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买灯");
    await enterSelection(host);
    await clickSelectRow(host, "买灯");

    vi.spyOn(db.goals, "add").mockRejectedValueOnce(new Error("写库失败"));

    await typeProjectName(host, "装修");
    await clickByLabel(host, "圈成项目");

    await waitForToast(host, "暂时建不了组");
    expect(errorSpy).toHaveBeenCalled();
    expect(selectionBar(host)).not.toBeNull();
    await unmount(root);
  });

  it("手头区键盘拖拽重排：sortOrder 落库、视图顺序更新", async () => {
    const now = "2026-06-28T09:00:00.000Z";
    const a = await addTask({ title: "买菜", toInbox: true });
    const b = await addTask({ title: "洗碗", toInbox: true });
    await grabTaskToHand(a.id, { now: new Date(now) });
    await grabTaskToHand(b.id, { now: new Date(now) });

    const { host, root } = await renderPage();
    await waitForCondition(
      () => host.querySelector('[data-section="todo-at-hand"] [aria-label="移动 洗碗"]') !== null,
      "at-hand drag handle",
      settle,
    );

    // 窄屏布局 atHandBlock 排最前；今天/收件箱为空、无项目组 → droppable 只有手头两行，
    // closestCenter 取挂载顺序第一名 = 买菜。拖第二行（洗碗）落到买菜上 = 交换序。
    await keyboardDrag(host.querySelector('[data-section="todo-at-hand"] [aria-label="移动 洗碗"]') as HTMLElement);

    // 落库轮询照 waitForTask 的写法：waitForCondition 的断言是同步 predicate，async 断言
    // 返回 Promise 恒 truthy、第一轮就放行，不会真等到回流——视图断言必须在回流完成后读。
    // 读取必须包在 act 里：persistTaskOrder 写入会触发 liveQuery 重渲染，act 外裸读会报
    // "not wrapped in act" 噪声。
    let swapped = false;
    for (let i = 0; i < 20 && !swapped; i += 1) {
      let aRow: Task | undefined;
      let bRow: Task | undefined;
      await act(async () => {
        aRow = await db.tasks.get(a.id);
        bRow = await db.tasks.get(b.id);
      });
      swapped = aRow !== undefined && bRow !== undefined && aRow.sortOrder > bRow.sortOrder;
      if (!swapped) await settle();
    }
    expect(swapped).toBe(true);

    await waitForCondition(
      () =>
        host.querySelector('[data-section="todo-at-hand"] [aria-label^="移动 "]')?.getAttribute("aria-label") ===
        "移动 洗碗",
      "at-hand view reordered",
      settle,
    );
    await unmount(root);
  });

  it("手头区重排是乐观的：落库完成前视图已按新序渲染（不出现先回弹再硬跳）", async () => {
    // 拦截 persistTaskOrder 挂起：验证「放手即落位」不依赖落库回流。
    // 承重点：若乐观接线被删（reorder 分支只 await、不 setOptimisticOrder），
    // 本用例在 resolve 前断言 DOM 会拿到旧序而红——这是本功能的核心行为。
    const now = "2026-06-28T09:00:00.000Z";
    let resolvePersist: (() => void) | null = null;
    const persistSpy = vi
      .spyOn(tasksLib, "persistTaskOrder")
      .mockImplementationOnce((_orderedIds: string[]) => new Promise<void>((resolve) => { resolvePersist = resolve; }));

    const a = await addTask({ title: "买菜", toInbox: true });
    const b = await addTask({ title: "洗碗", toInbox: true });
    await grabTaskToHand(a.id, { now: new Date(now) });
    await grabTaskToHand(b.id, { now: new Date(now) });

    const { host, root } = await renderPage();
    await waitForCondition(
      () => host.querySelector('[data-section="todo-at-hand"] [aria-label="移动 洗碗"]') !== null,
      "at-hand drag handle",
      settle,
    );

    await keyboardDrag(host.querySelector('[data-section="todo-at-hand"] [aria-label="移动 洗碗"]') as HTMLElement);

    // persistTaskOrder 尚未 resolve：视图顺序必须已经翻转（乐观渲染生效）。
    await waitForCondition(
      () =>
        host.querySelector('[data-section="todo-at-hand"] [aria-label^="移动 "]')?.getAttribute("aria-label") ===
        "移动 洗碗",
      "optimistic view reordered before persist resolves",
      settle,
    );

    resolvePersist?.();
    await act(async () => {
      await persistSpy.mock.results[0]?.value;
    });
    persistSpy.mockRestore();
    await unmount(root);
  });
});

describe("拖拽投递坞", () => {
  it("宽屏键盘拖起收件箱行:坞出细条预告、药丸集合正确;Escape 后隐藏", async () => {
    // 宽屏:useIsWideScreen 走 matchMedia("(min-width: 1024px)")。存原值,测试尾恢复,别污染同文件其他用例。
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      const now = "2026-06-28T09:00:00.000Z";
      const member = await addTask({ title: "刷墙", toInbox: true });
      await db.goals.add({
        id: "g1",
        title: "装修房子",
        kind: "project",
        status: "active",
        members: [{ kind: "task", id: member.id }],
        prerequisites: [],
        createdAt: now,
        updatedAt: now,
      });
      await addTask({ title: "买窗帘", toInbox: true });
      const { host, root } = await renderPage();
      await waitForText(host, "买窗帘");

      const dockEl = () => host.querySelector('[data-testid="todo-drag-dock"]');
      await waitForCondition(() => dockEl() !== null, "dock 常驻挂载");
      expect(dockEl()?.getAttribute("data-dock-state")).toBe("hidden");

      const handle = host.querySelector('[aria-label="移动 买窗帘"]') as HTMLElement;
      await act(async () => {
        handle.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
      });
      // 键盘拖拽恒基线档，坞只出细条预告、不接投递。
      expect(dockEl()?.getAttribute("data-dock-state")).toBe("hint");
      const ids = [...host.querySelectorAll('[data-testid="todo-dock-pill"]')].map((el) =>
        el.getAttribute("data-dock-id"),
      );
      expect(ids).toContain("dock:pool:today");
      expect(ids).toContain("dock:hand");
      expect(ids).toContain("dock:project:g1");
      expect(ids).not.toContain("dock:pool:inbox");

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true, cancelable: true }));
      });
      await waitForCondition(() => dockEl()?.getAttribute("data-dock-state") === "hidden", "松手即散");
      await unmount(root);
    } finally {
      if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    }
  });

  it("宽屏鼠标拖起后左拉过阈值:坞展开成完整形态,右拉回位再收回细条", async () => {
    // 2026-08-03 真机验收退回的回归闸。车道判定曾吃 dnd-kit `onDragMove` 的 `event.delta`,
    // 而那个值是过了 modifiers 之后的——`clampTodoIndentPreview` 把根任务的 x 夹进 [0,28],
    // 出坞要的负位移在那条通路上结构性不存在,坞左拉多远都停在 hint。纯函数层(直接喂 -28 当然进 dock)
    // 与 modifier 层(只断言自己钳得对)各自的用例都不会红,只有这条跨到页面接线的会。
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      await addTask({ title: "买窗帘", toInbox: true });
      const { host, root } = await renderPage();
      await waitForText(host, "买窗帘");

      const dockEl = () => host.querySelector('[data-testid="todo-drag-dock"]');
      await waitForCondition(() => dockEl() !== null, "dock 常驻挂载");
      const dockState = () => dockEl()?.getAttribute("data-dock-state");
      expect(dockState()).toBe("hidden");

      // 起手点随便挑一处视口坐标:判定只看它与后续指针坐标的差,不依赖 jsdom 量不出的布局。
      const START = { x: 300, y: 400 };
      const handle = host.querySelector('[aria-label="移动 买窗帘"]') as HTMLElement;
      // MouseSensor 的 activationConstraint 是 { delay: 180, tolerance: 6 }:按住不动等它激活。
      // 用假定时器推过去,不占真实墙钟。
      vi.useFakeTimers();
      try {
        await act(async () => {
          handle.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: START.x, clientY: START.y }),
          );
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(260);
        });
      } finally {
        vi.useRealTimers();
      }
      await waitForCondition(() => dockState() === "hint", "拖起后先出细条预告");

      // 左拉 200px:远超根任务出坞阈值 -28。
      await act(async () => {
        window.dispatchEvent(
          new MouseEvent("pointermove", { bubbles: true, clientX: START.x - 200, clientY: START.y }),
        );
      });
      await waitForCondition(() => dockState() === "engaged", "左拉过阈值坞展开");

      // 右拉回起手点:位移 0 已过释放线(-12),坞收回细条。jsdom 里坞矩形恒 0,指针够不着它,
      // holdDock 不会误锁——这正是"右移回去坞也不关"那条复审用例的页面侧对照。
      await act(async () => {
        window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: START.x, clientY: START.y }));
      });
      await waitForCondition(() => dockState() === "hint", "右拉回位坞收回细条");

      await act(async () => {
        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await waitForCondition(() => dockState() === "hidden", "松手即散");
      await unmount(root);
    } finally {
      if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    }
  });

  it("窄屏(默认 jsdom)不渲染坞", async () => {
    await addTask({ title: "买窗帘", toInbox: true });
    const { host, root } = await renderPage();
    await waitForText(host, "买窗帘");
    expect(host.querySelector('[data-testid="todo-drag-dock"]')).toBeNull();
    await unmount(root);
  });

  it("手头子任务拖起时坞不出任何药丸:父在手头,与手头根行(拖起不出坞)保持一致", async () => {
    // 用户反馈原话：「手头收掉扩展坞，回池已经有 × 按钮了」——手头区整个区都不该出坞，
    // 子任务的容器 id 只有 `parent:<父id>` 一种形状，本例专锁「父在手头」这条要落成坞恒空。
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      const now = "2026-06-28T09:00:00.000Z";
      const parent = await addTask({ title: "父任务", toInbox: true });
      await grabTaskToHand(parent.id, { now: new Date(now) });
      await createChildTask(parent.id, "子任务");
      // 挂一个可落的项目组：即便坞里本该有项目药丸可选，本例仍要证明手头子任务源坞恒空——
      // 不是"碰巧没有候选"，而是判定层主动拦下了它。
      await db.goals.add({
        id: "g1",
        title: "装修房子",
        kind: "project",
        status: "active",
        members: [],
        prerequisites: [],
        createdAt: now,
        updatedAt: now,
      });

      const { host, root } = await renderPage();
      await waitForCondition(
        () => host.querySelector('[data-section="todo-at-hand"] [aria-label="移动 父任务"]') !== null,
        "at-hand parent row",
        settle,
      );

      // 展开父任务的子任务层（点抓取区），子任务行的拖柄才存在（同「拖起子任务或重复待办…」用例）。
      await act(async () => {
        (host.querySelector('[data-section="todo-at-hand"] [aria-label="移动 父任务"]') as HTMLElement).dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      await waitForCondition(
        () => host.querySelector('[data-section="todo-at-hand"] [aria-label="拖动子任务 子任务"]') !== null,
        "at-hand child drag handle",
        settle,
      );

      const dockEl = () => host.querySelector('[data-testid="todo-drag-dock"]');
      await waitForCondition(() => dockEl() !== null, "dock 常驻挂载");

      const childHandle = host.querySelector(
        '[data-section="todo-at-hand"] [aria-label="拖动子任务 子任务"]',
      ) as HTMLElement;
      await act(async () => {
        childHandle.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }));
      });
      // 手头源空坞连细条都不出(hidden 态),药丸恒零——与手头根行(拖起不出坞)保持一致。
      expect(dockEl()?.getAttribute("data-dock-state")).toBe("hidden");
      expect(host.querySelectorAll('[data-testid="todo-dock-pill"]').length).toBe(0);

      await unmount(root);
    } finally {
      if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
    }
  });
});
