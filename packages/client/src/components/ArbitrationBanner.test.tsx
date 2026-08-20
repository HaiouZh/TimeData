// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderDom, unmount } from "../test/domHarness.tsx";
import ArbitrationBanner from "./ArbitrationBanner.tsx";

const useSyncContextMock = vi.hoisted(() => vi.fn());
const clearPendingArbitrationMock = vi.hoisted(() => vi.fn());

vi.mock("../contexts/SyncContext.tsx", () => ({
  useOptionalSyncContext: useSyncContextMock,
}));

vi.mock("../sync/arbitration.ts", () => ({
  clearPendingArbitration: clearPendingArbitrationMock,
}));

function pendingRow(overrides: Partial<{
  recordId: string;
  tableName: string;
  payloadJson: string;
  rejectedAt: string;
}> = {}) {
  return {
    recordId: overrides.recordId ?? "entry-1",
    tableName: overrides.tableName ?? "time_entries",
    action: "create" as const,
    payloadJson: overrides.payloadJson ?? JSON.stringify({ startTime: "2026-08-19T01:00:00.000Z", endTime: "2026-08-19T02:00:00.000Z" }),
    syncLogIds: ["log-1"],
    rejectedAt: overrides.rejectedAt ?? "2026-08-19T12:00:00.000Z",
    disposition: "pending" as const,
  };
}

describe("ArbitrationBanner", () => {
  beforeEach(() => {
    useSyncContextMock.mockReset();
    clearPendingArbitrationMock.mockReset();
    useSyncContextMock.mockReturnValue({ pendingArbitrations: [] });
  });

  it("有 time_entries 待处理行 → 横幅出现，且文案里含那句覆盖警告", () => {
    useSyncContextMock.mockReturnValue({
      pendingArbitrations: [pendingRow()],
    });
    const html = renderToStaticMarkup(createElement(ArbitrationBanner, { onGoToDate: () => {} }));
    expect(html).toContain("有 1 条记录没能同步到云端");
    expect(html).toContain("云端在同一时段已有别的记录");
    expect(html).toContain("注意：如果你原样再保存一次，云端那些会被删掉。");
    expect(html).toContain("2026-08-19");
    expect(html).toContain("09:00");
  });

  it("只有 categories 的待处理行 → 横幅不出现", () => {
    useSyncContextMock.mockReturnValue({
      pendingArbitrations: [
        pendingRow({ recordId: "cat-1", tableName: "categories", payloadJson: JSON.stringify({ startTime: "2026-08-19T01:00:00.000Z", endTime: "2026-08-19T02:00:00.000Z" }) }),
      ],
    });
    const html = renderToStaticMarkup(createElement(ArbitrationBanner, { onGoToDate: () => {} }));
    expect(html).not.toContain("没能同步到云端");
    expect(html).not.toContain("注意：如果你原样再保存一次");
    // StatusBanner tone warn should not appear
    expect(html).not.toContain('data-tone="warn"');
  });

  it("payloadJson 是 __serializeFailed 存根 → 该行被跳过、不崩", () => {
    useSyncContextMock.mockReturnValue({
      pendingArbitrations: [
        pendingRow({ payloadJson: JSON.stringify({ __serializeFailed: true, reason: "oops" }) }),
      ],
    });
    const html = renderToStaticMarkup(createElement(ArbitrationBanner, { onGoToDate: () => {} }));
    // 没有有效条目，横幅应为 null，不崩且不显示警告
    expect(html).not.toContain("没能同步到云端");
    expect(html).not.toContain("注意：如果你原样再保存一次");
    expect(html).toBe("");
  });

  it("点「知道了」→ clearPendingArbitration 被调用且传的是那一条的 recordId", async () => {
    useSyncContextMock.mockReturnValue({
      pendingArbitrations: [pendingRow({ recordId: "entry-abc" })],
    });
    const { host, root } = await renderDom(createElement(ArbitrationBanner, { onGoToDate: () => {} }));
    try {
      const btn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("知道了"));
      expect(btn).toBeTruthy();
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // allow microtask
      await new Promise((r) => setTimeout(r, 0));
      expect(clearPendingArbitrationMock).toHaveBeenCalledTimes(1);
      expect(clearPendingArbitrationMock).toHaveBeenCalledWith("entry-abc");
    } finally {
      await unmount(root);
    }
  });

  it("多于一条 → 显示「还有 N-1 条」", () => {
    useSyncContextMock.mockReturnValue({
      pendingArbitrations: [
        pendingRow({ recordId: "entry-latest", rejectedAt: "2026-08-19T12:00:00.000Z", payloadJson: JSON.stringify({ startTime: "2026-08-19T01:00:00.000Z", endTime: "2026-08-19T02:00:00.000Z" }) }),
        pendingRow({ recordId: "entry-older", rejectedAt: "2026-08-19T11:00:00.000Z", payloadJson: JSON.stringify({ startTime: "2026-08-18T01:00:00.000Z", endTime: "2026-08-18T02:00:00.000Z" }) }),
      ],
    });
    const html = renderToStaticMarkup(createElement(ArbitrationBanner, { onGoToDate: () => {} }));
    expect(html).toContain("有 2 条记录没能同步到云端");
    expect(html).toContain("还有 1 条");
    // 应只显示最新一条的日期
    expect(html).toContain("2026-08-19");
  });
});
