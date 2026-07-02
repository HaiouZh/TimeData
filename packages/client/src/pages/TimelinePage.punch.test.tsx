// @vitest-environment jsdom

import type { TimeEntry } from "@timedata/shared";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../test/domHarness.js";
import TimelinePage from "./TimelinePage.js";

const punchNowMock = vi.hoisted(() => vi.fn());
const deleteEntryMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../lib/punch.ts", () => ({ punchNow: punchNowMock }));

vi.mock("../hooks/useEntries.ts", () => ({
  useEntries: () => ({ entries: [], previousEntry: null }),
  useEntryMutations: () => ({ deleteEntry: deleteEntryMock }),
}));

vi.mock("../components/DateNav.tsx", () => ({
  default: ({ date, onDateChange }: { date: string; onDateChange: (date: string) => void }) => (
    <button type="button" onClick={() => onDateChange("2026-06-24")}>
      日期 {date}
    </button>
  ),
}));

vi.mock("../components/CircularTimeline.tsx", () => ({
  default: ({ onPunch }: { onPunch?: () => void }) => (
    <button type="button" onClick={onPunch}>
      打点
    </button>
  ),
}));

vi.mock("../components/SyncIndicator.tsx", () => ({
  default: () => <span data-sync-indicator="true">sync-dot</span>,
}));

vi.mock("../components/Timeline.tsx", () => ({
  default: () => <div>timeline</div>,
}));

vi.mock("../hooks/useMidnightTick.ts", () => ({
  useMidnightTick: () => undefined,
}));

vi.mock("../lib/overnightDisplaySetting.ts", () => ({
  getMergeOvernightEnabled: () => true,
}));

function punchEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-punch",
    categoryId: "cat-1",
    startTime: "2026-05-13T07:00:00.000Z",
    endTime: "2026-05-13T08:00:00.000Z",
    note: null,
    createdAt: "2026-05-13T08:00:00.000Z",
    updatedAt: "2026-05-13T08:00:00.000Z",
    ...overrides,
  };
}

async function renderTimeline() {
  return renderDom(
    <MemoryRouter>
      <TimelinePage />
    </MemoryRouter>,
  );
}

function getButton(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find((button) => button.textContent === label);
}

function getDateButton(host: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.startsWith("日期 "));
}

function getToast(host: HTMLElement): Element | null {
  return host.querySelector('[role="status"][aria-label="打点反馈"]');
}

describe("TimelinePage 打点反馈", () => {
  beforeEach(() => {
    vi.useRealTimers();
    punchNowMock.mockReset();
    deleteEntryMock.mockReset();
    navigateMock.mockReset();
  });

  it("打点成功显示时间范围与撤销，撤销删掉该条", async () => {
    punchNowMock.mockResolvedValue({ ok: true, entry: punchEntry() });
    deleteEntryMock.mockResolvedValue(undefined);

    const { host, root } = await renderTimeline();
    try {
      await click(getButton(host, "打点"));

      await vi.waitFor(() => {
        const toast = getToast(host);
        expect(toast?.textContent).toContain("已打点 15:00–16:00");
        expect(toast?.textContent).toContain("撤销");
      });

      await click(getButton(host, "撤销"));

      expect(deleteEntryMock).toHaveBeenCalledWith("entry-punch");
      expect(getToast(host)).toBeNull();
    } finally {
      await unmount(root);
    }
  });

  it("missing_category 提示带「去设置」入口", async () => {
    punchNowMock.mockResolvedValue({ ok: false, reason: "missing_category" });

    const { host, root } = await renderTimeline();
    try {
      await click(getButton(host, "打点"));

      await vi.waitFor(() => {
        const toast = getToast(host);
        expect(toast?.textContent).toContain("请先在设置 · 记录偏好选择打点分类");
        expect(toast?.textContent).toContain("去设置");
      });

      await click(getButton(host, "去设置"));

      expect(navigateMock).toHaveBeenCalledWith("/settings/insights");
    } finally {
      await unmount(root);
    }
  });

  it("punchNow 抛错时兜底提示而非静默", async () => {
    punchNowMock.mockRejectedValue(new Error("IndexedDB 不可用"));

    const { host, root } = await renderTimeline();
    try {
      await click(getButton(host, "打点"));

      await vi.waitFor(() => {
        expect(getToast(host)?.textContent).toContain("IndexedDB 不可用");
      });
    } finally {
      await unmount(root);
    }
  });

  it("切换日期会清掉当前打点反馈", async () => {
    punchNowMock.mockResolvedValue({ ok: false, reason: "missing_category" });

    const { host, root } = await renderTimeline();
    try {
      await click(getButton(host, "打点"));

      await vi.waitFor(() => {
        expect(getToast(host)?.textContent).toContain("请先在设置 · 记录偏好选择打点分类");
      });

      await click(getDateButton(host));

      expect(getToast(host)).toBeNull();
    } finally {
      await unmount(root);
    }
  });

  it("no_range 提示会自动消失", async () => {
    vi.useFakeTimers();
    punchNowMock.mockResolvedValue({ ok: false, reason: "no_range" });

    const { host, root } = await renderTimeline();
    try {
      await click(getButton(host, "打点"));

      await vi.waitFor(() => {
        expect(getToast(host)?.textContent).toContain("距上次记录还没有时间");
      });

      await act(async () => {
        vi.advanceTimersByTime(6000);
      });

      expect(getToast(host)).toBeNull();
    } finally {
      await unmount(root);
      vi.useRealTimers();
    }
  });
});
