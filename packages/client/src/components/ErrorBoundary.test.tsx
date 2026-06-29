// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import { ErrorBoundary } from "./ErrorBoundary.js";

describe("ErrorBoundary", () => {
  it("shows fallback when child throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const Bad = () => {
      throw new Error("boom");
    };

    const { host, root } = await renderDom(createElement(ErrorBoundary, null, createElement(Bad)));

    expect(host.textContent).toContain("应用出错了");
    expect(host.textContent).toContain("boom");
    consoleError.mockRestore();
    await unmount(root);
  });
});
