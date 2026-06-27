import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SyncIndicator, { syncIndicatorClassName } from "./SyncIndicator.js";

const useSyncContextMock = vi.hoisted(() => vi.fn());

vi.mock("../contexts/SyncContext.tsx", () => ({
  useSyncContext: useSyncContextMock,
}));

describe("syncIndicatorClassName", () => {
  it("uses the expected color and animation classes", () => {
    expect(syncIndicatorClassName("disabled")).toContain("bg-ink-3");
    expect(syncIndicatorClassName("success")).toContain("bg-ok");
    expect(syncIndicatorClassName("idle")).toContain("bg-ok");
    expect(syncIndicatorClassName("syncing")).toContain("bg-warn");
    expect(syncIndicatorClassName("syncing")).toContain("animate-sync-pulse");
    expect(syncIndicatorClassName("error")).toContain("bg-danger");
    expect(syncIndicatorClassName("error")).toContain("animate-sync-blink");
    expect(syncIndicatorClassName("pending")).toContain("bg-accent");
  });
});

describe("SyncIndicator", () => {
  it("renders a non-interactive status dot", () => {
    useSyncContextMock.mockReturnValue({ status: "syncing" });

    const html = renderToStaticMarkup(createElement(SyncIndicator));

    expect(html).toContain('aria-label="同步状态：同步中"');
    expect(html).toContain("animate-sync-pulse");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("href=");
  });

  it("renders a readable pending aria label", () => {
    useSyncContextMock.mockReturnValue({ status: "pending" });

    const html = renderToStaticMarkup(createElement(SyncIndicator));

    expect(html).toContain('aria-label="同步状态：待上传"');
    expect(html).toContain("bg-accent");
  });
});
