// @vitest-environment jsdom
import type { Goal, QuickNote, Task, Track } from "@timedata/shared";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import OverviewPage from "./OverviewPage.js";

vi.mock("../../hooks/useAppResumeRefresh.ts", () => ({ useAppResumeRefresh: () => {} }));

const DAY = 86_400_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

function goal(overrides: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  return {
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: ago(60 * DAY),
    updatedAt: ago(60 * DAY),
    ...overrides,
  };
}

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    parentId: null,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    weight: 0,
    completedAt: null,
    tags: [],
    ruleId: null,
    sessionId: null,
    skipped: false,
    sortOrder: 0,
    createdAt: ago(DAY),
    updatedAt: ago(DAY),
    ...overrides,
  };
}

function track(overrides: Partial<Track> & Pick<Track, "id" | "title">): Track {
  return {
    status: "active",
    refs: [],
    createdAt: ago(DAY),
    updatedAt: ago(DAY),
    ...overrides,
  };
}

function note(overrides: Partial<QuickNote> & Pick<QuickNote, "id" | "text">): QuickNote {
  return {
    occurredAt: ago(DAY),
    createdAt: ago(DAY),
    updatedAt: ago(DAY),
    ...overrides,
  };
}

async function seed(): Promise<void> {
  await db.goals.bulkAdd([
    goal({ id: "g1", title: "TimeData", members: [{ kind: "task", id: "t1" }, { kind: "track", id: "k1" }] }),
    goal({ id: "g2", title: "发布 v2", members: [{ kind: "task", id: "t1" }] }),
  ]);
  await db.tasks.bulkAdd([task({ id: "t1", title: "写周报" })]);
  await db.tracks.bulkAdd([track({ id: "k1", title: "全貌改版" })]);
  await db.quickNotes.bulkAdd([
    note({ id: "n1", text: "看步频视频" }),
    note({ id: "n2", text: "旧想法 跑鞋", occurredAt: ago(20 * DAY), createdAt: ago(20 * DAY), updatedAt: ago(20 * DAY) }),
    note({ id: "n3", text: "跑鞋 换新", occurredAt: ago(25 * DAY), createdAt: ago(25 * DAY), updatedAt: ago(25 * DAY) }),
  ]);
}

function installMatchMedia(wide: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: wide,
      media: "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 20; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function renderPage() {
  const rendered = await renderDom(
    <MemoryRouter initialEntries={["/goals"]}>
      <Routes>
        <Route path="/goals" element={<OverviewPage />} />
        <Route path="/tracks/:id" element={<div>轨道页占位</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await flush();
  return rendered;
}

function starButton(host: HTMLElement, label: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function searchBox(host: HTMLElement): HTMLInputElement {
  const element = host.querySelector('input[aria-label="找星星"]');
  if (!(element instanceof HTMLInputElement)) throw new Error("missing search box");
  return element;
}

async function typeInto(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function typeIntoTextarea(element: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressEnter(element: HTMLTextAreaElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
  });
}

function dialogText(host: HTMLElement): string {
  return host.querySelector('[role="dialog"]')?.textContent ?? "";
}

beforeEach(async () => {
  await resetDb();
  installMatchMedia(true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("OverviewPage", () => {
  it("数据到齐前只显示加载占位", async () => {
    await seed();
    let release: (rows: QuickNote[]) => void = () => {};
    vi.spyOn(db.quickNotes, "toArray").mockImplementationOnce(
      () =>
        new Promise<QuickNote[]>((resolve) => {
          release = resolve;
        }),
    );
    const { host, root } = await renderPage();
    expect(host.querySelector("[data-overview-loading]")).not.toBeNull();
    expect(host.textContent ?? "").not.toContain("TimeData");
    const rows = await db.quickNotes.toArray();
    await act(async () => {
      release(rows);
    });
    await flush();
    expect(host.querySelector("[data-overview-loading]")).toBeNull();
    expect(host.textContent ?? "").toContain("TimeData");
    await unmount(root);
  });

  it("宽屏显示天空，窄屏显示清单", async () => {
    await seed();
    const wide = await renderPage();
    expect(wide.host.querySelector('[aria-label="星的图例"]')).not.toBeNull();
    expect([...wide.host.querySelectorAll("h2")].map((heading) => heading.textContent ?? "")).toContain("TimeData");
    expect(wide.host.querySelector("li > button[aria-expanded]")).toBeNull();
    await unmount(wide.root);
    installMatchMedia(false);
    const narrow = await renderPage();
    expect(narrow.host.querySelector('[aria-label="星的图例"]')).toBeNull();
    expect(narrow.host.querySelectorAll("li > button[aria-expanded]").length).toBeGreaterThan(0);
    expect(narrow.host.querySelector("h2")).toBeNull();
    await unmount(narrow.root);
  });

  it("搜索后只剩匹配的星，暗处的也搜得到，显示找到 N 颗", async () => {
    await seed();
    const { host, root } = await renderPage();
    expect(starButton(host, "你丢的：旧想法 跑鞋")).toBeNull();
    expect(starButton(host, "你丢的：看步频视频")).not.toBeNull();
    await typeInto(searchBox(host), "跑鞋");
    expect(starButton(host, "你丢的：旧想法 跑鞋")).not.toBeNull();
    expect(starButton(host, "你丢的：跑鞋 换新")).not.toBeNull();
    expect(starButton(host, "你丢的：看步频视频")).toBeNull();
    expect(host.textContent ?? "").toContain("找到 2 颗");
    await unmount(root);
  });

  it("搜不到时说没找到，不说天上没有星星", async () => {
    await seed();
    const { host, root } = await renderPage();
    await typeInto(searchBox(host), "完全不存在的词");
    expect(host.textContent ?? "").toContain("找到 0 颗");
    expect(host.textContent ?? "").toContain("没找到匹配的星");
    expect(host.textContent ?? "").not.toContain("天上还没有星星");
    await unmount(root);
  });

  it("「管理事情」链到 /goals/manage", async () => {
    await seed();
    const { host, root } = await renderPage();
    const link = [...host.querySelectorAll("a")].find((anchor) => anchor.textContent === "管理事情");
    expect(link?.getAttribute("href")).toBe("/goals/manage");
    await unmount(root);
  });

  it("点 ○ 星打开详情，详情里列出它所在的团", async () => {
    await seed();
    const { host, root } = await renderPage();
    await click(starButton(host, "你丢的：写周报"));
    expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe("你丢的");
    expect(dialogText(host)).toContain("TimeData");
    expect(dialogText(host)).toContain("发布 v2");
    await unmount(root);
  });

  it("搜索时点星，详情仍列出它所在的全部团", async () => {
    await seed();
    const { host, root } = await renderPage();
    await typeInto(searchBox(host), "TimeData");
    expect(host.textContent ?? "").not.toContain("看步频视频");
    await click(starButton(host, "你丢的：写周报"));
    expect(dialogText(host)).toContain("发布 v2");
    await unmount(root);
  });

  it("点 ◇ 星直接进轨道页", async () => {
    await seed();
    const { host, root } = await renderPage();
    await click(starButton(host, "项目进度：全貌改版"));
    await flush();
    expect(host.textContent ?? "").toContain("轨道页占位");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });

  it("搜索框里留着词时丢进一条，搜索清空，新的星露出来", async () => {
    await seed();
    const { host, root } = await renderPage();
    await typeInto(searchBox(host), "跑鞋");
    expect(starButton(host, "你丢的：看步频视频")).toBeNull();
    const entry = host.querySelector('textarea[aria-label="丢进来"]');
    if (!(entry instanceof HTMLTextAreaElement)) throw new Error("missing entry");
    await typeIntoTextarea(entry, "新想法 一条");
    await pressEnter(entry);
    await flush();
    expect(searchBox(host).value).toBe("");
    expect(starButton(host, "你丢的：新想法 一条")).not.toBeNull();
    await unmount(root);
  });

  it("「找到 N 颗」写在一直挂着的播报区里", async () => {
    await seed();
    const { host, root } = await renderPage();
    const status = searchBox(host).parentElement?.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe("");
    await typeInto(searchBox(host), "跑鞋");
    expect(status?.isConnected).toBe(true);
    expect(status?.textContent).toBe("找到 2 颗");
    await typeInto(searchBox(host), "");
    expect(status?.textContent).toBe("");
    await unmount(root);
  });

  it("详情开着时那颗星的内容变了，详情跟着变", async () => {
    await seed();
    const { host, root } = await renderPage();
    await click(starButton(host, "你丢的：看步频视频"));
    expect(dialogText(host)).toContain("看步频视频");
    await db.quickNotes.update("n1", { text: "看步频视频 第二遍", updatedAt: new Date().toISOString() });
    await flush();
    expect(dialogText(host)).toContain("看步频视频 第二遍");
    await unmount(root);
  });

  it("详情开着时那颗星被删了，详情关上", async () => {
    await seed();
    const { host, root } = await renderPage();
    await click(starButton(host, "你丢的：看步频视频"));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await db.quickNotes.delete("n1");
    await flush();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await unmount(root);
  });

  it("窄屏搜索时命中的行直接展开，清空搜索后收回", async () => {
    installMatchMedia(false);
    await seed();
    const { host, root } = await renderPage();
    expect(starButton(host, "你丢的：看步频视频")).toBeNull();
    await typeInto(searchBox(host), "跑鞋");
    expect(starButton(host, "你丢的：旧想法 跑鞋")).not.toBeNull();
    expect(starButton(host, "你丢的：跑鞋 换新")).not.toBeNull();
    await typeInto(searchBox(host), "");
    expect(starButton(host, "你丢的：看步频视频")).toBeNull();
    await unmount(root);
  });
});
