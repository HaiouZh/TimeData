// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ErrorBoundary", () => {
  it("shows fallback when child throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const Bad = () => {
      throw new Error("boom");
    };

    await act(async () => {
      createRoot(container).render(createElement(ErrorBoundary, null, createElement(Bad)));
    });

    expect(container.textContent).toContain("应用出错了");
    expect(container.textContent).toContain("boom");
    consoleError.mockRestore();
  });
});
