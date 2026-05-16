import { describe, expect, it } from "vitest";
import { shouldAutoSyncOnMount, shouldShowSyncDiagnosticsHint } from "./useSync.js";

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
