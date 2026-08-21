// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../test/dbReset.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { addDays } from "../../lib/time.js";

const fetchDiaryMock = vi.fn(async (_date: string) => ({ content: "", mtime: null as number | null }));

vi.mock("../../lib/diary/diaryApi.ts", async () => {
  const actual = await vi.importActual<typeof import("../../lib/diary/diaryApi.js")>("../../lib/diary/diaryApi.ts");
  return { ...actual, fetchDiary: (...args: unknown[]) => fetchDiaryMock(...(args as [string])) };
});

import { DiaryMobileRefBar } from "./DiaryMobileRefBar.js";

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

function getChips(host: HTMLElement): HTMLButtonElement[] {
  // chips 容器里的按钮，按 label 区分；用 aria-expanded 来识别 chips（展开区按钮不带该属性）
  return [...host.querySelectorAll('button[aria-expanded]')] as HTMLButtonElement[];
}

function findChip(host: HTMLElement, labelPart: string): HTMLButtonElement {
  const chip = getChips(host).find((b) => b.textContent?.includes(labelPart));
  if (!chip) throw new Error(`找不到 chip：${labelPart}，现有：${getChips(host).map((b) => b.textContent).join("|")}`);
  return chip;
}

describe("DiaryMobileRefBar", () => {
  it("默认只渲染一行 chips，无展开区", async () => {
    mounted = await renderDom(
      createElement(DiaryMobileRefBar, { date: "2026-07-25", isToday: true, guideItems: ["回看昨日小记", "亮点&成就"] }),
    );
    await flush();
    const { host } = mounted;
    const chips = getChips(host);
    // 应有 6 个：打点、待办、速记、昨天、上周、引导
    expect(chips.length).toBe(6);
    expect(chips.map((b) => b.textContent).join("|")).toContain("打点");
    expect(chips.map((b) => b.textContent).join("|")).toContain("待办");
    expect(chips.map((b) => b.textContent).join("|")).toContain("速记");
    expect(chips.map((b) => b.textContent).join("|")).toContain("昨天");
    expect(chips.map((b) => b.textContent).join("|")).toContain("上周");
    expect(chips.map((b) => b.textContent).join("|")).toContain("引导");
    expect(host.querySelector('[data-testid="diary-mobile-ref-active"]')).toBeNull();
  });

  it("单开切换：点『打点』展开该块，点『速记』切换，同时最多一块", async () => {
    mounted = await renderDom(
      createElement(DiaryMobileRefBar, { date: "2026-07-25", isToday: true, guideItems: ["x"] }),
    );
    await flush();
    const { host } = mounted;

    await act(async () => {
      findChip(host, "打点").click();
    });
    await flush();
    let active = host.querySelector('[data-testid="diary-mobile-ref-active"]') as HTMLElement | null;
    expect(active).not.toBeNull();
    // 展开区内应有打点块的标题，且只有一个展开区
    expect(active!.textContent).toContain("打点");
    expect(host.querySelectorAll('[data-testid="diary-mobile-ref-active"]').length).toBe(1);

    await act(async () => {
      findChip(host, "速记").click();
    });
    await flush();
    active = host.querySelector('[data-testid="diary-mobile-ref-active"]') as HTMLElement | null;
    expect(active).not.toBeNull();
    expect(active!.textContent).toContain("速记");
    // 切换后打点块不应再在展开区内（单开语义）
    // 通过检查展开区内的特定空态文案区分：打点块空态为"这天没有打点"，速记为"这天没有速记"
    // 由于两者共用 CollapsibleSection 标题"打点"/"速记"，用空态更精准
    await waitFor(() => active!.textContent?.includes("速记") === true, "速记块已渲染");
    // 展开区标题应为速记而非打点的主标题可通过 summary 区分，但为简化断言展开区不含打点空态
    // 若仍含打点空态说明未切换
    // 注意：芯片行的"打点"按钮仍在 host 中，但不在 active 内部；所以检查 active 内部是否含打点空态
    expect(active!.textContent).not.toContain("这天没有打点");
    expect(host.querySelectorAll('[data-testid="diary-mobile-ref-active"]').length).toBe(1);
  });

  it("再点当前 chip 收起", async () => {
    mounted = await renderDom(
      createElement(DiaryMobileRefBar, { date: "2026-07-25", isToday: true, guideItems: ["回看昨日小记"] }),
    );
    await flush();
    const { host } = mounted;
    await act(async () => {
      findChip(host, "引导").click();
    });
    await flush();
    expect(host.querySelector('[data-testid="diary-mobile-ref-active"]')).not.toBeNull();
    await act(async () => {
      findChip(host, "引导").click();
    });
    await flush();
    expect(host.querySelector('[data-testid="diary-mobile-ref-active"]')).toBeNull();
  });

  it("guideItems 为空时不渲染『引导』chip，其余五个照常", async () => {
    mounted = await renderDom(
      createElement(DiaryMobileRefBar, { date: "2026-07-25", isToday: true, guideItems: [] }),
    );
    await flush();
    const { host } = mounted;
    const chips = getChips(host);
    expect(chips.length).toBe(5);
    expect(chips.map((b) => b.textContent).join("|")).not.toContain("引导");
    expect(chips.map((b) => b.textContent).join("|")).toContain("打点");
    expect(chips.map((b) => b.textContent).join("|")).toContain("待办");
    expect(chips.map((b) => b.textContent).join("|")).toContain("速记");
    expect(chips.map((b) => b.textContent).join("|")).toContain("昨天");
    expect(chips.map((b) => b.textContent).join("|")).toContain("上周");
  });

  it("点『昨天』挂载即发起前一日 fetchDiary + 失败重试", async () => {
    const date = "2026-07-25";
    const yesterday = addDays(date, -1);
    fetchDiaryMock.mockRejectedValueOnce(new Error("boom"));
    mounted = await renderDom(
      createElement(DiaryMobileRefBar, { date, isToday: true, guideItems: [] }),
    );
    await flush();
    const { host } = mounted;
    await act(async () => {
      findChip(host, "昨天").click();
    });
    await waitFor(() => host.textContent?.includes("读取失败") === true, "错误态");
    expect(fetchDiaryMock).toHaveBeenCalledTimes(1);
    expect(fetchDiaryMock).toHaveBeenCalledWith(yesterday);
    expect(fetchDiaryMock.mock.calls[0][0]).toBe(yesterday);
    // 重试
    fetchDiaryMock.mockResolvedValueOnce({ content: "昨天写的东西", mtime: 1 });
    const retryBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("重试")) as HTMLButtonElement;
    expect(retryBtn).toBeDefined();
    await act(async () => {
      retryBtn.click();
    });
    await waitFor(() => host.textContent?.includes("昨天写的东西") === true, "重试成功");
  });

  it("非今天时回看 chips 文案为『前一天/前七天』", async () => {
    mounted = await renderDom(
      createElement(DiaryMobileRefBar, { date: "2026-07-25", isToday: false, guideItems: ["x"] }),
    );
    await flush();
    const { host } = mounted;
    const labels = getChips(host).map((b) => b.textContent ?? "");
    expect(labels.join("|")).toContain("前一天");
    expect(labels.join("|")).toContain("前七天");
    expect(labels.join("|")).not.toContain("昨天");
    expect(labels.join("|")).not.toContain("上周");
  });

  it("可访问性：chips 分组可命名、chip 关联展开区、选中态不只靠颜色、滚容器可聚焦", async () => {
    mounted = await renderDom(
      createElement(DiaryMobileRefBar, { date: "2026-07-25", isToday: true, guideItems: ["x"] }),
    );
    await flush();
    const { host } = mounted;

    const group = host.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("日记参考条");

    const chip = findChip(host, "打点");
    expect(chip.getAttribute("aria-controls")).toBe("diary-mobile-ref-active");
    await act(async () => {
      chip.click();
    });
    await flush();

    // 选中态除变色外还有字重变化（aria-expanded 之外的可视信号）
    expect(chip.className).toContain("font-semibold");
    expect(findChip(host, "速记").className).not.toContain("font-semibold");

    const region = host.querySelector('[data-testid="diary-mobile-ref-active"]') as HTMLElement;
    expect(region.id).toBe("diary-mobile-ref-active");
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toBe("参考内容");
    expect(region.tabIndex).toBe(0);
  });

  it("切日期后旧请求迟到返回不覆盖新结果（cancelled 守卫）", async () => {
    let resolveFirst: (v: { content: string; mtime: number | null }) => void = () => {};
    fetchDiaryMock.mockImplementationOnce(
      () => new Promise<{ content: string; mtime: number | null }>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    mounted = await renderDom(
      createElement(DiaryMobileRefBar, { date: "2026-07-25", isToday: true, guideItems: [] }),
    );
    await flush();
    const { host, root } = mounted;
    await act(async () => {
      findChip(host, "昨天").click();
    });
    await flush();
    expect(host.textContent).toContain("读取中");

    // 切日期：MobileLookback 不卸载、date prop 变化触发 effect 重跑，旧请求闭包应被 cancelled 拦下
    fetchDiaryMock.mockResolvedValueOnce({ content: "24 号的正文", mtime: 2 });
    await act(async () => {
      root.render(createElement(DiaryMobileRefBar, { date: "2026-07-26", isToday: false, guideItems: [] }));
    });
    await waitFor(() => host.textContent?.includes("24 号的正文") === true, "新日期内容");

    // 旧请求此刻才 resolve——内容不得回退成旧日期的正文
    await act(async () => {
      resolveFirst({ content: "23 号的旧正文", mtime: 1 });
    });
    await flush();
    expect(host.textContent).toContain("24 号的正文");
    expect(host.textContent).not.toContain("23 号的旧正文");
  });
});
