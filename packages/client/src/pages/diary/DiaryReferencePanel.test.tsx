// @vitest-environment jsdom
// 参考栏块测试：seed 真 db，故 dbReset 必须先于任何触 db/index 的模块求值。
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../test/dbReset.js";
import { renderDom, unmount } from "../../test/domHarness.js";

const fetchDiaryMock = vi.fn(async (_date: string) => ({ content: "", mtime: null as number | null }));

// 路径必须写 ".ts" 而不是 ".js"——本仓 vi.mock 按 vitest 的解析路径匹配，
// `DiaryPage.test.tsx` 已验证的写法就是 ".ts"，写成 ".js" 会静默不生效（mock 没挂上、
// 测试却因为真去请求而以别的方式失败，极难排查）。用 importActual 展开保留其余导出。
vi.mock("../../lib/diary/diaryApi.ts", async () => {
  const actual = await vi.importActual<typeof import("../../lib/diary/diaryApi.js")>("../../lib/diary/diaryApi.ts");
  return { ...actual, fetchDiary: (...args: unknown[]) => fetchDiaryMock(...(args as [string])) };
});

import { DiaryReferencePanel } from "./DiaryReferencePanel.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  localStorage.clear();
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  fetchDiaryMock.mockReset();
  fetchDiaryMock.mockResolvedValue({ content: "", mtime: null });
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

describe("参考栏 · 速记块", () => {
  async function addNote(id: string, text: string, occurredAt: string) {
    await db.quickNotes.add({
      id, text, occurredAt,
      createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z",
    } as never);
  }

  it("列出当天速记并带时间", async () => {
    await addNote("n1", "他提的那个点值得记", "2026-07-25T02:30:00.000Z");
    const { host } = await renderPanel("2026-07-25");
    await waitFor(() => host.querySelector('[data-testid="diary-ref-quick-note-list"]') !== null, "速记列表");
    const list = host.querySelector('[data-testid="diary-ref-quick-note-list"]') as HTMLElement;
    expect(list.textContent).toContain("他提的那个点值得记");
    expect(list.textContent).toContain("10:30");
  });

  it("别的日期的速记不出现在这天", async () => {
    await addNote("n1", "上周记的", "2026-07-20T02:30:00.000Z");
    const { host } = await renderPanel("2026-07-25");
    await waitFor(() => host.textContent?.includes("这天没有速记") === true, "空态");
    expect(host.textContent).not.toContain("上周记的");
  });

  it("切日期时速记跟着换，不留上一天的残留", async () => {
    await addNote("n1", "周一记的", "2026-07-20T02:30:00.000Z");
    await addNote("n2", "周六记的", "2026-07-25T02:30:00.000Z");

    const { host, root } = await renderPanel("2026-07-20");
    await waitFor(() => host.textContent?.includes("周一记的") === true, "07-20 的速记");

    await act(async () => {
      root.render(createElement(DiaryReferencePanel, { date: "2026-07-25", isToday: true }));
    });
    await waitFor(() => host.textContent?.includes("周六记的") === true, "07-25 的速记");
    expect(host.textContent).not.toContain("周一记的");
  });
});

describe("参考栏 · 回看块", () => {
  function lookbackButton(host: HTMLElement, label: string): HTMLButtonElement {
    const btns = [...host.querySelectorAll("button")] as HTMLButtonElement[];
    const found = btns.find((b) => b.textContent?.includes(label));
    if (!found) throw new Error(`找不到按钮：${label}`);
    return found;
  }

  it("默认收起，不发请求", async () => {
    const { host } = await renderPanel("2026-07-25");
    expect(host.textContent).toContain("昨天 7月24日");
    expect(host.textContent).toContain("上周今日 7月18日");
    expect(fetchDiaryMock).not.toHaveBeenCalled();
  });

  it("展开才请求，且拉的是相对当前日期的前一天", async () => {
    const { host } = await renderPanel("2026-07-25");
    fetchDiaryMock.mockResolvedValue({ content: "昨天写的东西", mtime: 1 });

    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await waitFor(() => host.textContent?.includes("昨天写的东西") === true, "昨天正文");

    expect(fetchDiaryMock).toHaveBeenCalledWith("2026-07-24");
  });

  it("那天没写日记时出空态，不当成错误", async () => {
    const { host } = await renderPanel("2026-07-25");
    fetchDiaryMock.mockResolvedValue({ content: "", mtime: null });

    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await waitFor(() => host.textContent?.includes("这天没写日记") === true, "空态");
    expect(host.textContent).not.toContain("读取失败");
  });

  it("请求失败出重试按钮，点了会重发", async () => {
    const { host } = await renderPanel("2026-07-25");
    fetchDiaryMock.mockRejectedValue(new Error("boom"));

    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await waitFor(() => host.textContent?.includes("读取失败") === true, "错误态");

    fetchDiaryMock.mockResolvedValue({ content: "重试拿到的", mtime: 1 });
    await act(async () => {
      lookbackButton(host, "读取失败").click();
    });
    await waitFor(() => host.textContent?.includes("重试拿到的") === true, "重试成功");
  });

  it("已展开加载过的内容，不会因为再次折叠展开而重复请求", async () => {
    const { host } = await renderPanel("2026-07-25");
    fetchDiaryMock.mockResolvedValue({ content: "只拉一次", mtime: 1 });

    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await waitFor(() => host.textContent?.includes("只拉一次") === true, "首次加载");
    const callsAfterFirst = fetchDiaryMock.mock.calls.length;

    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await flush();

    expect(fetchDiaryMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("切日期后回看收起，且不把上一天的正文留在屏幕上", async () => {
    const { host, root } = await renderPanel("2026-07-25");
    fetchDiaryMock.mockResolvedValue({ content: "7月24日的正文", mtime: 1 });

    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await waitFor(() => host.textContent?.includes("7月24日的正文") === true, "首次加载");

    await act(async () => {
      root.render(createElement(DiaryReferencePanel, { date: "2026-07-20", isToday: false }));
    });
    await flush();

    expect(host.textContent).not.toContain("7月24日的正文");
    expect(host.textContent).toContain("昨天 7月19日");
  });

  it("A→B→A 切回原日期后，旧的在途响应不会覆盖新状态", async () => {
    // ABA 判据：若闸用日期字符串比较，切回 07-25 时旧响应的日期又相等、闸失效。
    const { host, root } = await renderPanel("2026-07-25");

    // 用 definite-assignment（`!`）而不是 `| null = null`：后者会让 TS 的控制流分析在
    // 后面把 resolveFirst 收窄成 null，`resolveFirst?.()` 直接编译报错。
    let resolveFirst!: (v: { content: string; mtime: number | null }) => void;
    const pending = new Promise<{ content: string; mtime: number | null }>((resolve) => {
      resolveFirst = resolve;
    });
    fetchDiaryMock.mockImplementationOnce(() => pending);

    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await waitFor(() => host.textContent?.includes("读取中") === true, "加载中");

    // A → B → A
    await act(async () => {
      root.render(createElement(DiaryReferencePanel, { date: "2026-07-20", isToday: false }));
    });
    await act(async () => {
      root.render(createElement(DiaryReferencePanel, { date: "2026-07-25", isToday: true }));
    });
    await flush();

    // 旧响应此刻才回来
    await act(async () => {
      resolveFirst({ content: "早就作废的正文", mtime: 1 });
    });
    await flush();

    expect(host.textContent).not.toContain("早就作废的正文");
  });
});
