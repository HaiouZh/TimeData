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

// 让「完成的待办」块的数据源可控地抛错（验证错误围栏）。默认透传真实实现，
// 只有 tasksFailure.shouldFail 打开时才 reject——否则同文件里其余待办用例全会被带塌。
const tasksFailure = vi.hoisted(() => ({ shouldFail: false }));

// 打点块的「查询未回」那一帧靠"渲染完立刻断言"抓不到：domHarness 的 act 会把 dexie 查询一起 drain 掉。
// 这道闸把查询按在半空中，才断得到加载态。闸不开时不 await 任何东西（保住 dexie 的订阅追踪）。
const punchGate = vi.hoisted(() => ({ hold: null as Promise<void> | null }));

vi.mock("../../lib/diary/diaryRefEntries.ts", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/diary/diaryRefEntries.js")>("../../lib/diary/diaryRefEntries.ts");
  return {
    ...actual,
    listEntriesOverlappingDay: async (date: string) => {
      if (punchGate.hold) await punchGate.hold;
      return actual.listEntriesOverlappingDay(date);
    },
  };
});

vi.mock("../../lib/tasks.ts", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tasks.js")>("../../lib/tasks.ts");
  return {
    ...actual,
    listTasks: async (...args: Parameters<typeof actual.listTasks>) => {
      if (tasksFailure.shouldFail) throw new Error("Dexie 读失败");
      return actual.listTasks(...args);
    },
  };
});

import { DiaryReferencePanel } from "./DiaryReferencePanel.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;

beforeEach(async () => {
  localStorage.clear();
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  fetchDiaryMock.mockReset();
  fetchDiaryMock.mockResolvedValue({ content: "", mtime: null });
  tasksFailure.shouldFail = false;
  punchGate.hold = null;
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

  // 曾经用 useEntries，它内部 `useLiveQuery(...) || []` 把「查询未回」的 undefined 兜底成空数组，
  // 于是打点块在加载中直接谎报「这天没有打点」——同屏另外两块此刻还写着「读取中…」，三块自相矛盾。
  it("加载中出「读取中…」而不是把没查完当成「这天没有打点」", async () => {
    let release!: () => void;
    punchGate.hold = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    mounted = await renderDom(createElement(DiaryReferencePanel, { date: "2026-07-25", isToday: true }));
    const punches = mounted.host.querySelectorAll("details")[0];

    expect(punches.textContent).toContain("读取中…");
    expect(punches.textContent).not.toContain("这天没有打点");

    // 放行后才落到空态，证明上面断的是真加载中，不是这块永久卡住。
    await act(async () => {
      release();
    });
    await waitFor(() => punches.textContent?.includes("这天没有打点") === true, "空态最终到达");
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

  // 上面两条都只渲染单一日期，`useLiveQuery` 的依赖数组丢了 `[date]` 照样全绿。
  // 生产后果：宽屏切日期后标题已经是新日期，完成待办列表还停在上一天。
  it("切日期时完成的待办跟着换，不停在上一天", async () => {
    await addTask({ id: "t1", title: "周一收的尾", completedAt: "2026-07-20T02:00:00.000Z" });
    await addTask({ id: "t2", title: "周六收的尾", completedAt: "2026-07-25T02:00:00.000Z" });

    const { host, root } = await renderPanel("2026-07-20", false);
    await waitFor(() => host.textContent?.includes("周一收的尾") === true, "07-20 的完成待办");

    await act(async () => {
      root.render(createElement(DiaryReferencePanel, { date: "2026-07-25", isToday: true }));
    });
    await waitFor(() => host.textContent?.includes("周六收的尾") === true, "07-25 的完成待办");
    expect(host.textContent).not.toContain("周一收的尾");
  });
});

describe("参考栏 · 每块各自的错误围栏", () => {
  // `useLiveQuery` 的 error 通道就是「在 render 里 throw」（dexie-react-hooks 源码里显式写着
  // 「Throw if observable has emitted error so that an ErrorBoundrary can catch it」）。不自己围，
  // 最近的边界是根路由 errorElement——它把整个 app shell 换成「应用出错了」，而日记正文只活在
  // DiaryPage 的 React state，整页一掀就永久丢。
  it("一块的数据源抛错，只有那块显示失败提示，其余块与参考栏之外的东西都不受影响", async () => {
    // React 把未被 boundary 静默的渲染错误打到 console.error；这里是预期内的，压掉噪声。
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await db.quickNotes.add({
        id: "n1", text: "速记照常出", occurredAt: "2026-07-25T02:30:00.000Z",
        createdAt: "2026-07-25T00:00:00.000Z", updatedAt: "2026-07-25T00:00:00.000Z",
      } as never);
      tasksFailure.shouldFail = true;

      // 栏外放一个哨兵：错误若冒出参考栏，整棵树被替换，它会一起消失。
      mounted = await renderDom(
        createElement(
          "div",
          null,
          createElement("p", null, "栏外的正文哨兵"),
          createElement(DiaryReferencePanel, { date: "2026-07-25", isToday: true }),
        ),
      );
      const { host } = mounted;

      // ① 出错那块自己显示失败提示
      await waitFor(() => host.textContent?.includes("完成的待办读取失败") === true, "完成待办块的失败提示");

      // ② 另外几块正常
      await waitFor(() => host.textContent?.includes("速记照常出") === true, "速记块仍正常");
      expect(host.textContent).toContain("这天没有打点");
      expect(host.textContent).toContain("昨天 7月24日");

      // ③ 参考栏本体与栏外内容都没被掀掉
      expect(host.querySelector('[data-testid="diary-reference-panel"]')).not.toBeNull();
      expect(host.textContent).toContain("栏外的正文哨兵");
      expect(host.textContent).not.toContain("应用出错了");
    } finally {
      consoleError.mockRestore();
    }
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

  // 看历史日期时，上半区标题写着「7月20日」，回看却说「昨天 7月19日」——同屏两句互相矛盾的话。
  // 数据口径本来就对（相对 date 而非相对真实今天），错的只是措辞。
  it("看历史日期时不说「昨天 / 上周今日」，改成不带绝对时间断言的措辞", async () => {
    const { host } = await renderPanel("2026-07-20", false);

    expect(host.textContent).toContain("前一天 7月19日");
    expect(host.textContent).toContain("前七天 7月13日");
    expect(host.textContent).not.toContain("昨天");
    expect(host.textContent).not.toContain("上周今日");
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
    // 切到的是历史日期（isToday=false），措辞随之变成不带绝对时间断言的「前一天」。
    expect(host.textContent).toContain("前一天 7月19日");
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

  // 上一条只断言"折叠状态下看不见旧正文"，而切日的重置 effect 本来就会收起——两条闸
  // 保护的是同一个可观察面，删掉 epoch 守卫也照样绿。真正暴露它的是**再次展开**：
  // 迟到响应若把 state 写成 loaded，toggle() 会因为 state.kind 不是 idle 而跳过重新请求，
  // 于是把上一个日期的正文渲染在新日期的标签下。
  it("迟到响应被作废后，再次展开会重新请求而不是显示旧日期的正文", async () => {
    const { host, root } = await renderPanel("2026-07-25");

    let resolveStale!: (v: { content: string; mtime: number | null }) => void;
    const stale = new Promise<{ content: string; mtime: number | null }>((resolve) => {
      resolveStale = resolve;
    });
    fetchDiaryMock.mockImplementationOnce(() => stale);

    await act(async () => {
      lookbackButton(host, "昨天").click();
    });
    await waitFor(() => host.textContent?.includes("读取中") === true, "加载中");

    // 切到别的日期：重置 effect 收起并清空
    await act(async () => {
      root.render(createElement(DiaryReferencePanel, { date: "2026-07-20", isToday: false }));
    });
    await flush();

    // 07-24 的旧响应此刻才回来，必须被 epoch 守卫挡掉
    await act(async () => {
      resolveStale({ content: "07-24 的正文", mtime: 1 });
    });
    await flush();

    // 再次展开：应当为新日期（前一天 = 07-19）重新发请求，而不是端出滞留的旧内容。
    // 这里按钮文案是「前一天」而非「昨天」：切过去的是历史日期，isToday=false。
    fetchDiaryMock.mockResolvedValue({ content: "07-19 的正文", mtime: 2 });
    await act(async () => {
      lookbackButton(host, "前一天").click();
    });
    await waitFor(() => host.textContent?.includes("07-19 的正文") === true, "新日期正文");

    expect(host.textContent).not.toContain("07-24 的正文");
    expect(fetchDiaryMock).toHaveBeenCalledWith("2026-07-19");
  });
});
