// @vitest-environment jsdom
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shouldAutoSyncOnMount, shouldShowSyncDiagnosticsHint, useSync } from "./useSync.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../sync/engine.ts", () => ({
  getConsecutiveSyncFailureCount: () => 0,
  getSyncHealth: vi.fn(),
  prepareForcePush: vi.fn(),
  regularSync: vi.fn(),
  syncForcePushToServer: vi.fn(),
  syncForceReplace: vi.fn(),
}));

vi.mock("../sync/conflicts.ts", () => ({
  resolveConflicts: vi.fn(),
}));

vi.mock("../backup/autoBackup.ts", () => ({
  createAutoBackup: vi.fn(),
}));

vi.mock("../lib/serverHealth.ts", () => ({
  fetchServerHealth: vi.fn(async () => true),
}));

vi.mock("../db/index.ts", () => ({
  db: {
    syncLog: {
      filter: () => ({ count: async () => 0 }),
    },
  },
}));

beforeEach(() => {
  localStorage.clear();
});

describe("shouldShowSyncDiagnosticsHint", () => {
  it("shows diagnostics hint only when sync has failed repeatedly", () => {
    expect(shouldShowSyncDiagnosticsHint(0)).toBe(false);
    expect(shouldShowSyncDiagnosticsHint(2)).toBe(false);
    expect(shouldShowSyncDiagnosticsHint(3)).toBe(true);
  });
});

describe("shouldAutoSyncOnMount", () => {
  it("only allows automatic sync when both server and cloud sync are enabled", () => {
    expect(shouldAutoSyncOnMount("https://example.com", true)).toBe(true);
    expect(shouldAutoSyncOnMount("https://example.com", false)).toBe(false);
    expect(shouldAutoSyncOnMount("", true)).toBe(false);
    expect(shouldAutoSyncOnMount(null, true)).toBe(false);
  });
});

describe("useSync", () => {
  it("returns the same object reference across unrelated parent rerenders", async () => {
    const seenValues: unknown[] = [];
    let triggerUnrelatedRerender: () => void = () => undefined;

    function Probe() {
      seenValues.push(useSync());
      return createElement("span", null, "probe");
    }

    function Wrapper() {
      const [unrelated, setUnrelated] = useState(0);
      triggerUnrelatedRerender = () => setUnrelated((value) => value + 1);
      return createElement("div", { "data-unrelated": unrelated }, createElement(Probe));
    }

    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(Wrapper));
    });

    const initialValue = seenValues.at(-1);

    await act(async () => {
      triggerUnrelatedRerender();
    });

    expect(seenValues.at(-1)).toBe(initialValue);

    await act(async () => {
      root.unmount();
    });
  });

  it("sync 在服务器连不上时设置错误且跳过 regularSync", async () => {
    const { regularSync } = await import("../sync/engine.ts");
    const { fetchServerHealth } = await import("../lib/serverHealth.ts");
    vi.mocked(fetchServerHealth).mockResolvedValueOnce(false);

    const captured: { value: ReturnType<typeof useSync> | null } = { value: null };
    function Probe() {
      captured.value = useSync();
      return createElement("span", null, "probe");
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Probe));
    });

    await act(async () => {
      await captured.value?.sync();
    });

    expect(captured.value?.error).toBeTruthy();
    expect(vi.mocked(regularSync)).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
