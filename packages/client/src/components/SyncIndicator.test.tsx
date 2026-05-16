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
    expect(syncIndicatorClassName("disabled")).toContain("bg-gray-400");
    expect(syncIndicatorClassName("success")).toContain("bg-green-500");
    expect(syncIndicatorClassName("idle")).toContain("bg-green-500");
    expect(syncIndicatorClassName("syncing")).toContain("bg-yellow-500");
    expect(syncIndicatorClassName("syncing")).toContain("animate-sync-pulse");
    expect(syncIndicatorClassName("error")).toContain("bg-red-500");
    expect(syncIndicatorClassName("error")).toContain("animate-sync-blink");
  });
});

describe("SyncIndicator", () => {
  it("renders a non-interactive status dot", () => {
    useSyncContextMock.mockReturnValue({ status: "syncing" });

    const html = renderToStaticMarkup(createElement(SyncIndicator));

    expect(html).toContain("aria-label=\"同步状态：syncing\"");
    expect(html).toContain("animate-sync-pulse");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("href=");
  });
});
