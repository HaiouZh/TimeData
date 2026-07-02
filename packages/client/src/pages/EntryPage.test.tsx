import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EntryPage, { resolveTimelineDateAfterSave } from "./EntryPage.js";

const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams("") }));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({}),
  useSearchParams: () => [searchParamsMock.value, vi.fn()],
}));

const confirmMock = vi.hoisted(() => vi.fn());
const entryFormPropsMock = vi.hoisted(() => ({
  value: null as null | {
    onSave: (
      categoryId: string,
      nextStartTime: string,
      nextEndTime: string,
      note: string,
    ) => Promise<{ ok: boolean; error?: string } | undefined>;
  },
}));

const useLatestEntryEndTimeBeforeMock = vi.hoisted(() => vi.fn<(categoryId: string | null) => string | null>(() => null));
const findOverlappingEntriesMock = vi.hoisted(() => vi.fn());
const planEntryOverlapAdjustmentsMock = vi.hoisted(() => vi.fn());
const saveEntryWithOverlapAdjustmentsMock = vi.hoisted(() => vi.fn());

vi.mock("../hooks/useConfirm.tsx", () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));

vi.mock("../hooks/useEntries.js", () => ({
  useEntry: () => null,
  useEntryMutations: () => ({ addEntry: vi.fn(), updateEntry: vi.fn(), deleteEntry: vi.fn() }),
  useLatestEntryEndTimeBefore: useLatestEntryEndTimeBeforeMock,
  findOverlappingEntries: findOverlappingEntriesMock,
  planEntryOverlapAdjustments: planEntryOverlapAdjustmentsMock,
  applyEntryOverlapAdjustments: vi.fn(),
  saveEntryWithOverlapAdjustments: saveEntryWithOverlapAdjustmentsMock,
}));

vi.mock("../components/EntryForm.js", () => ({
  default: (props: {
    startTime: string;
    endTime: string;
    onSave: (
      categoryId: string,
      nextStartTime: string,
      nextEndTime: string,
      note: string,
    ) => Promise<{ ok: boolean; error?: string } | undefined>;
  }) => {
    entryFormPropsMock.value = props;
    return createElement("div", null, `${props.startTime} ${props.endTime}`);
  },
}));

describe("EntryPage default times", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchParamsMock.value = new URLSearchParams("");
    navigateMock.mockReset();
    useLatestEntryEndTimeBeforeMock.mockReturnValue(null);
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    findOverlappingEntriesMock.mockReset();
    findOverlappingEntriesMock.mockResolvedValue([]);
    planEntryOverlapAdjustmentsMock.mockReset();
    saveEntryWithOverlapAdjustmentsMock.mockReset();
    saveEntryWithOverlapAdjustmentsMock.mockResolvedValue({});
    entryFormPropsMock.value = null;
  });

  it("keeps the URL gap bounds when start and end (and date=today) are already provided", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    searchParamsMock.value = new URLSearchParams(
      "date=2026-05-08&start=2026-05-08T06:00:00&end=2026-05-08T07:00:00",
    );
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-08T00:30:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage));

    expect(useLatestEntryEndTimeBeforeMock).toHaveBeenCalledWith(null);
    expect(html).toContain("2026-05-08T06:00:00 2026-05-08T07:00:00");
  });

  it("clamps default end to the selected date's 23:59 when date param points to a past day", () => {
    vi.setSystemTime(new Date("2026-05-16T07:30:00+08:00"));
    // queryEnd 是次日 00:00（昨天尾部空挡的 dayEnd 转回来）；date=2026-05-15 表示用户在昨天页面点的
    searchParamsMock.value = new URLSearchParams(
      "date=2026-05-15&start=2026-05-14T16%3A00%3A00.000Z&end=2026-05-15T16%3A00%3A00.000Z",
    );
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-16T00:30:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage));

    expect(useLatestEntryEndTimeBeforeMock).toHaveBeenCalledWith(null);
    // start 保留 queryStart（同 date 那天），end 被钉到 date 当天 23:59
    expect(html).toContain("2026-05-15T00:00:00 2026-05-15T23:59:00");
  });

  it("ignores malformed timezone-aware query values instead of crashing", () => {
    vi.setSystemTime(new Date("2026-05-16T07:30:00+08:00"));
    searchParamsMock.value = new URLSearchParams(
      "date=2026-05-16&start=2026-05-14T16%3A00%3A00fooZ&end=2026-99-99T16%3A00%3A00Z",
    );

    const html = renderToStaticMarkup(createElement(EntryPage));

    expect(html).toContain("2026-05-16T06:30:00 2026-05-16T07:30:00");
  });

  it("computes default start and end times from the current clock when no params", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));

    const html = renderToStaticMarkup(createElement(EntryPage));

    expect(html).toContain("2026-05-08T06:30:00 2026-05-08T07:30:00");
  });

  it("uses the latest entry end time only when no query params exist", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-07T22:45:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage));

    expect(html).toContain("2026-05-08T06:45:00 2026-05-08T07:30:00");
  });

  it("falls back to now-60min when previous endTime is not before end", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-08T00:45:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage));

    expect(html).toContain("2026-05-08T06:30:00 2026-05-08T07:30:00");
  });

  it("saves with overlap adjustments after confirmation (no shift)", async () => {
    vi.setSystemTime(new Date("2026-05-17T20:00:00+08:00"));
    const overlap = { id: "old", startTime: "2026-05-17T00:00:00.000Z", endTime: "2026-05-17T02:00:00.000Z" };
    const plan = {
      ok: true,
      updates: [{ id: "old", startTime: "2026-05-17T00:00:00.000Z", endTime: "2026-05-17T01:00:00.000Z" }],
      deletes: [],
    };
    findOverlappingEntriesMock.mockResolvedValue([overlap]);
    planEntryOverlapAdjustmentsMock.mockReturnValue(plan);

    renderToStaticMarkup(createElement(EntryPage));
    await entryFormPropsMock.value?.onSave("cat-work", "2026-05-17T09:00:00", "2026-05-17T11:00:00", "new");

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(saveEntryWithOverlapAdjustmentsMock).toHaveBeenCalledWith({
      existingEntryId: null,
      categoryId: "cat-work",
      // 不再 shift：直接把表单回传的本地时间 toUtc
      startTime: "2026-05-17T01:00:00.000Z",
      endTime: "2026-05-17T03:00:00.000Z",
      note: "new",
      overlapPlan: plan,
    });
  });

  it("切两段阻断时返回 inline 错误而不再弹窗", async () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    findOverlappingEntriesMock.mockResolvedValue([{ id: "entry-x" }]);
    planEntryOverlapAdjustmentsMock.mockReturnValue({ ok: false });

    renderToStaticMarkup(createElement(EntryPage));
    const result = await entryFormPropsMock.value?.onSave(
      "cat-1",
      "2026-05-08T06:00:00",
      "2026-05-08T07:00:00",
      "",
    );

    expect(result).toEqual({
      ok: false,
      error: "这段时间会把已有记录切成两段，请先手动调整原记录后再保存。",
    });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(saveEntryWithOverlapAdjustmentsMock).not.toHaveBeenCalled();
  });

  it("跨天记录保存后返回结束时间所在日期的时间轴", async () => {
    vi.setSystemTime(new Date("2026-05-18T06:00:00+08:00"));

    renderToStaticMarkup(createElement(EntryPage));
    await entryFormPropsMock.value?.onSave(
      "cat-sleep",
      "2026-05-17T22:00:00",
      "2026-05-18T05:00:00",
      "overnight",
    );

    expect(saveEntryWithOverlapAdjustmentsMock).toHaveBeenCalledWith({
      existingEntryId: null,
      categoryId: "cat-sleep",
      startTime: "2026-05-17T14:00:00.000Z",
      endTime: "2026-05-17T21:00:00.000Z",
      note: "overnight",
      overlapPlan: null,
    });
    expect(navigateMock).toHaveBeenCalledWith("/?date=2026-05-18", { replace: true });
  });

  it("凌晨补记昨晚时段时整段回退一天再保存", async () => {
    vi.setSystemTime(new Date("2026-06-17T00:14:00+08:00"));

    renderToStaticMarkup(createElement(EntryPage));
    const result = await entryFormPropsMock.value?.onSave(
      "cat-work",
      "2026-06-17T23:41:00",
      "2026-06-17T23:50:00",
      "",
    );

    expect(result).toEqual({ ok: true });
    expect(findOverlappingEntriesMock).toHaveBeenCalledWith(
      "2026-06-16T15:41:00.000Z",
      "2026-06-16T15:50:00.000Z",
      undefined,
    );
    expect(saveEntryWithOverlapAdjustmentsMock).toHaveBeenCalledWith({
      existingEntryId: null,
      categoryId: "cat-work",
      startTime: "2026-06-16T15:41:00.000Z",
      endTime: "2026-06-16T15:50:00.000Z",
      note: null,
      overlapPlan: null,
    });
    expect(navigateMock).toHaveBeenCalledWith("/?date=2026-06-16", { replace: true });
  });

  it("blocks save with future error when onSave receives a still-future endTime", async () => {
    vi.setSystemTime(new Date("2026-05-20T14:00:00+08:00"));

    renderToStaticMarkup(createElement(EntryPage));
    const result = await entryFormPropsMock.value?.onSave(
      "cat-work",
      "2026-05-20T17:00:00",
      "2026-05-20T22:00:00",
      "",
    );

    expect(result).toEqual({ ok: false, error: "不能记录尚未发生的时间" });
    expect(findOverlappingEntriesMock).not.toHaveBeenCalled();
    expect(saveEntryWithOverlapAdjustmentsMock).not.toHaveBeenCalled();
  });
});

describe("resolveTimelineDateAfterSave", () => {
  it("同日记录返回开始日期", () => {
    expect(resolveTimelineDateAfterSave("2026-05-17T09:00:00", "2026-05-17T11:00:00")).toBe("2026-05-17");
  });

  it("跨天且结束时间有可见时长时返回结束日期", () => {
    expect(resolveTimelineDateAfterSave("2026-05-17T22:00:00", "2026-05-18T05:00:00")).toBe("2026-05-18");
  });

  it("跨天但精确结束在 00:00 时返回开始日期", () => {
    expect(resolveTimelineDateAfterSave("2026-05-17T22:00:00", "2026-05-18T00:00:00")).toBe("2026-05-17");
  });
});
