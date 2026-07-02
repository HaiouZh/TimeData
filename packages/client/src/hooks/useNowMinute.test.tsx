// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Root } from "../test/domHarness.js";
import { renderDom, unmount } from "../test/domHarness.js";

vi.mock("./useAppResumeRefresh.ts", () => ({
  useAppResumeRefresh: (onResume: () => void) => {
    resumeCallbackRef.current = onResume;
  },
}));
const resumeCallbackRef = vi.hoisted(() => ({ current: null as (() => void) | null }));

import { useNowMinute } from "./useNowMinute.js";

const observed: Date[] = [];

function Probe() {
  const now = useNowMinute();
  observed.push(now);
  return createElement("div", null, now.toISOString());
}

describe("useNowMinute", () => {
  let rendered: { host: HTMLElement; root: Root } | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T10:00:30+08:00"));
    observed.length = 0;
    rendered = null;
  });

  afterEach(async () => {
    if (rendered) await unmount(rendered.root);
    vi.useRealTimers();
  });

  it("重渲染之间引用稳定，不随渲染取新 Date", async () => {
    rendered = await renderDom(createElement(Probe));
    await act(async () => {
      rendered?.root.render(createElement(Probe));
    });

    expect(observed.length).toBeGreaterThanOrEqual(2);
    expect(observed.at(-1)).toBe(observed[0]);
  });

  it("跨分钟边界后更新为新的 now", async () => {
    rendered = await renderDom(createElement(Probe));
    const before = observed.at(-1);

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });

    const after = observed.at(-1);
    expect(after).not.toBe(before);
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it("回前台信号触发更新", async () => {
    rendered = await renderDom(createElement(Probe));
    const before = observed.at(-1);
    vi.setSystemTime(new Date("2026-07-02T10:00:45+08:00"));

    await act(async () => {
      resumeCallbackRef.current?.();
    });

    expect(observed.at(-1)).not.toBe(before);
  });
});
