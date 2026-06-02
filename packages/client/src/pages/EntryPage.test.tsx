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

const syncAfterWriteMock = vi.hoisted(() => vi.fn());
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
  useSyncContext: () => ({ syncAfterWrite: syncAfterWriteMock }),
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
    syncAfterWriteMock.mockReset();
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

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(useLatestEntryEndTimeBeforeMock).toHaveBeenCalledWith(null);
    expect(html).toContain("2026-05-08T06:00:00 2026-05-08T07:00:00");
  });

  it("clamps default end to ${date}T23:59:00 when date param points to a past day", () => {
    vi.setSystemTime(new Date("2026-05-16T07:30:00+08:00"));
    // queryEnd 是次日 00:00（昨天尾部空挡的 dayEnd 转回来）；date=2026-05-15 表示用户在昨天页面点的
    searchParamsMock.value = new URLSearchParams(
      "date=2026-05-15&start=2026-05-14T16%3A00%3A00.000Z&end=2026-05-15T16%3A00%3A00.000Z",
    );
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-16T00:30:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(useLatestEntryEndTimeBeforeMock).toHaveBeenCalledWith(null);
    // start 保留 queryStart（同 date 那天），end 被钉到 date 当天 23:59
    expect(html).toContain("2026-05-15T00:00:00 2026-05-15T23:59:00");
  });

  it("ignores malformed timezone-aware query values instead of crashing", () => {
    vi.setSystemTime(new Date("2026-05-16T07:30:00+08:00"));
    searchParamsMock.value = new URLSearchParams(
      "date=2026-05-16&start=2026-05-14T16%3A00%3A00fooZ&end=2026-99-99T16%3A00%3A00Z",
    );

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(html).toContain("2026-05-16T06:30:00 2026-05-16T07:30:00");
  });

  it("computes default start and end times from the current clock when no params", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(html).toContain("2026-05-08T06:30:00 2026-05-08T07:30:00");
  });

  it("uses the latest entry end time only when no query params exist", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-07T22:45:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

    expect(html).toContain("2026-05-08T06:45:00 2026-05-08T07:30:00");
  });

  it("falls back to now-60min when previous endTime is not before end", () => {
    vi.setSystemTime(new Date("2026-05-08T07:30:00+08:00"));
    useLatestEntryEndTimeBeforeMock.mockReturnValue("2026-05-08T00:45:00.000Z");

    const html = renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));

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

    renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));
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
    expect(syncAfterWriteMock).toHaveBeenCalledOnce();
  });

  it("blocks save with future error when onSave receives a still-future endTime", async () => {
    vi.setSystemTime(new Date("2026-05-20T14:00:00+08:00"));

    renderToStaticMarkup(createElement(EntryPage, { refreshKey: 0 }));
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
