// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";

const searchParamsMock = vi.hoisted(() => ({ value: new URLSearchParams("") }));
const resumeCallbacksRef = vi.hoisted(() => ({ current: [] as (() => void)[] }));
const formPropsLog = vi.hoisted(() => ({ value: [] as { startTime: string; endTime: string }[] }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useSearchParams: () => [searchParamsMock.value, vi.fn()],
  useLocation: () => ({ key: "default", pathname: "/entries/new" }),
}));

vi.mock("../hooks/useConfirm.tsx", () => ({ useConfirm: () => ({ confirm: vi.fn(), dialog: null }) }));
vi.mock("../hooks/useEntries.js", () => ({
  useEntry: () => null,
  useEntryMutations: () => ({ deleteEntry: vi.fn() }),
  useLatestEntryEndTimeBefore: () => null,
  findOverlappingEntries: vi.fn(),
  planEntryOverlapAdjustments: vi.fn(),
  saveEntryWithOverlapAdjustments: vi.fn(),
}));
vi.mock("../hooks/useAppResumeRefresh.ts", () => ({
  useAppResumeRefresh: (onResume: () => void) => {
    resumeCallbacksRef.current = [onResume];
  },
}));
vi.mock("../components/EntryForm.js", () => ({
  default: (props: { startTime: string; endTime: string }) => {
    formPropsLog.value.push({ startTime: props.startTime, endTime: props.endTime });
    return createElement("div", null, `${props.startTime} ${props.endTime}`);
  },
}));

import EntryPage from "./EntryPage.js";

describe("EntryPage 默认时间冻结 (TL-10)", () => {
  let rendered: { host: HTMLElement; root: Root } | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T07:30:30+08:00"));
    searchParamsMock.value = new URLSearchParams("");
    resumeCallbacksRef.current = [];
    formPropsLog.value = [];
    rendered = null;
  });

  afterEach(async () => {
    if (rendered) await unmount(rendered.root);
    vi.useRealTimers();
  });

  it("跨分钟重渲染不改默认时间；回前台才重算", async () => {
    rendered = await renderDom(createElement(EntryPage));
    const initial = formPropsLog.value.at(-1);

    vi.setSystemTime(new Date("2026-05-16T07:32:00+08:00"));
    await act(async () => {
      rendered?.root.render(createElement(EntryPage));
    });
    expect(formPropsLog.value.at(-1)).toEqual(initial);

    await act(async () => {
      resumeCallbacksRef.current[0]?.();
    });
    expect(formPropsLog.value.at(-1)).not.toEqual(initial);
    expect(formPropsLog.value.at(-1)?.endTime).toBe("2026-05-16T07:32:00");
  });
});
