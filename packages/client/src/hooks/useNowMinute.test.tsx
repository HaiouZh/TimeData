// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T10:00:30+08:00"));
    observed.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("重渲染之间引用稳定，不随渲染取新 Date", async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      root.render(createElement(Probe));
    });

    expect(observed.length).toBeGreaterThanOrEqual(2);
    expect(observed.at(-1)).toBe(observed[0]);
  });

  it("跨分钟边界后更新为新的 now", async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    const before = observed.at(-1);

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });

    const after = observed.at(-1);
    expect(after).not.toBe(before);
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it("回前台信号触发更新", async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    const before = observed.at(-1);
    vi.setSystemTime(new Date("2026-07-02T10:00:45+08:00"));

    await act(async () => {
      resumeCallbackRef.current?.();
    });

    expect(observed.at(-1)).not.toBe(before);
  });
});
