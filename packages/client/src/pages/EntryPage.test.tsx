import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EntryPage from "./EntryPage.js";

const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams("") }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useSearchParams: () => [searchParamsMock.value, vi.fn()],
}));

const syncIfStaleMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const entryFormPropsMock = vi.hoisted(() => ({
  value: null as null | {
    onSave: (
      categoryId: string,
      nextStartTime: string,
      nextEndTime: string,
      note: string,
    ) => Promise<{ ok: boolean; error?: string } | void>;
  },
}));

vi.mock("../contexts/SyncContext.tsx", () => ({
  useSyncContext: () => ({ syncIfStale: syncIfStaleMock }),
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
    ) => Promise<{ ok: boolean; error?: string } | void>;
  }) => {
    entryFormPropsMock.value = props;
    return createElement("div", null, `${props.startTime} ${props.endTime}`);
  },
}));

describe("EntryPage default times", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchParamsMock.value = new URLSearchParams("");
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

  it("keeps the URL gap bounds when start and end are already provided", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    searchParamsMock.value = new URLSearchParams("start=2026-05-08T06:00:00&end=2026-05-08T07:00:00");
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-08T00:30:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(useLatestEntryEndTimeBeforeMock).toHaveBeenCalledWith(null);
    expect(html).toContain("2026-05-08T06:00:00 2026-05-08T07:00:00");
  });

  it("converts UTC ISO gap bounds from timeline slots into local default times", () => {
    vi.setSystemTime(new Date("2026-05-16T07:30:00+08:00"));
    searchParamsMock.value = new URLSearchParams("start=2026-05-14T16%3A00%3A00.000Z&end=2026-05-15T16%3A00%3A00.000Z");
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-16T00:30:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(useLatestEntryEndTimeBeforeMock).toHaveBeenCalledWith(null);
    expect(html).toContain("2026-05-15T00:00:00 2026-05-16T00:00:00");
  });

  it("ignores malformed timezone-aware query values instead of crashing", () => {
    vi.setSystemTime(new Date("2026-05-16T07:30:00+08:00"));
    searchParamsMock.value = new URLSearchParams("start=2026-05-14T16%3A00%3A00fooZ&end=2026-99-99T16%3A00%3A00Z");

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(html).toContain("2026-05-16T06:30:00 2026-05-16T07:30:00");
  });

  it("computes default start and end times from the current clock", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(html).toContain("2026-05-08T06:30:00 2026-05-08T07:30:00");
  });

  it("uses the latest entry end time only when no query params exist", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    // UTC 22:45 前一天 = 上海 06:45 当天，不等于 fallback 的 06:30
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-07T22:45:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    // start 应是上一条 endTime 转回本地 06:45，而非 fallback 的 06:30
    expect(html).toContain("2026-05-08T06:45:00 2026-05-08T07:30:00");
  });

  it("falls back to now-60min when previous endTime is not before end", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    // UTC 00:45 = 上海 08:45，明显晚于 end=07:30
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-08T00:45:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(html).toContain("2026-05-08T06:30:00 2026-05-08T07:30:00");
  });

  it("saves with overlap adjustments after confirmation", async () => {
    vi.setSystemTime(new Date("2026-05-17T20:00:00+08:00"));
    const overlap = { id: "old", startTime: "2026-05-17T00:00:00.000Z", endTime: "2026-05-17T02:00:00.000Z" };
    const plan = {
      ok: true,
      updates: [{ id: "old", startTime: "2026-05-17T00:00:00.000Z", endTime: "2026-05-17T01:00:00.000Z" }],
      deletes: [],
    };
    findOverlappingEntriesMock.mockResolvedValue([overlap]);
    planEntryOverlapAdjustmentsMock.mockReturnValue(plan);

    renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));
    await entryFormPropsMock.value?.onSave("cat-work", "2026-05-17T09:00:00", "2026-05-17T11:00:00", "new");

    expect(confirmMock).toHaveBeenCalledOnce();
    expect(saveEntryWithOverlapAdjustmentsMock).toHaveBeenCalledWith({
      existingEntryId: null,
      categoryId: "cat-work",
      startTime: "2026-05-17T01:00:00.000Z",
      endTime: "2026-05-17T03:00:00.000Z",
      note: "new",
      overlapPlan: plan,
    });
  });
});

describe("EntryPage shift save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchParamsMock.value = new URLSearchParams("");
    useLatestEntryEndTimeBeforeMock.mockReturnValue(null);
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    findOverlappingEntriesMock.mockReset();
    planEntryOverlapAdjustmentsMock.mockReset();
    saveEntryWithOverlapAdjustmentsMock.mockReset();
    saveEntryWithOverlapAdjustmentsMock.mockResolvedValue({});
    entryFormPropsMock.value = null;
  });

  it("saves the shifted range silently when yesterday slot is empty", async () => {
    vi.setSystemTime(new Date("2026-05-20T03:00:00+08:00"));
    findOverlappingEntriesMock.mockResolvedValue([]);

    renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));
    const formProps = entryFormPropsMock.value;
    if (!formProps) throw new Error("EntryForm not rendered");

    const result = await formProps.onSave("cat-work", "2026-05-19T09:00:00", "2026-05-19T22:00:00", "");

    expect(findOverlappingEntriesMock).toHaveBeenCalled();
    expect(saveEntryWithOverlapAdjustmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        startTime: expect.stringContaining("2026-05-19"),
        endTime: expect.stringContaining("2026-05-19"),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("returns shift-conflict error when shifted range overlaps existing entries", async () => {
    vi.setSystemTime(new Date("2026-05-20T03:00:00+08:00"));
    findOverlappingEntriesMock.mockResolvedValue([
      { id: "e1", startTime: "2026-05-19T01:00:00.000Z", endTime: "2026-05-19T14:00:00.000Z" },
    ]);

    renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));
    const formProps = entryFormPropsMock.value;
    if (!formProps) throw new Error("EntryForm not rendered");

    const result = await formProps.onSave("cat-work", "2026-05-19T09:00:00", "2026-05-19T22:00:00", "");

    expect(result).toEqual({ ok: false, error: "不能记录尚未发生的时间" });
    expect(saveEntryWithOverlapAdjustmentsMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
