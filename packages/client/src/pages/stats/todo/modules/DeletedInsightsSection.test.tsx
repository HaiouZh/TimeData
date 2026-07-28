// @vitest-environment jsdom
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../../../test/domHarness.tsx";
import type { ArchiveItem } from "../../../../lib/todoStats/deletedStats.js";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/api.ts", () => ({
  apiFetch: apiFetchMock,
}));

const { default: DeletedInsightsSection } = await import("./DeletedInsightsSection.tsx");

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const okItems: ArchiveItem[] = [
  {
    taskId: "t1",
    deletedAt: "2026-07-20T04:00:00.000Z",
    deleteReason: "user",
    snapshot: { createdAt: "2026-07-01T00:00:00.000Z", completedAt: null },
  },
];

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("DeletedInsightsSection", () => {
  it("成功态渲染累计删除数与按周删除图", async () => {
    apiFetchMock.mockResolvedValueOnce({ items: okItems });
    const { host, root } = await renderDom(createElement(DeletedInsightsSection));
    await flushEffects();

    expect(host.textContent).toContain("累计删除 1 条");
    expect(host.textContent).toContain("删除数据自 2026-07-12 归档上线起算");

    await unmount(root);
  });

  it("失败态显示错误与重试按钮，且不阻塞——重试成功后切到成功态", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("网络错误"));
    const { host, root } = await renderDom(createElement(DeletedInsightsSection));
    await flushEffects();

    const retryButton = [...host.querySelectorAll("button")].find((btn) => btn.textContent === "重试");
    expect(retryButton).toBeTruthy();
    expect(host.textContent).toContain("网络错误");

    apiFetchMock.mockResolvedValueOnce({ items: okItems });
    await click(retryButton);
    await flushEffects();

    expect(host.textContent).toContain("累计删除 1 条");

    await unmount(root);
  });
});
