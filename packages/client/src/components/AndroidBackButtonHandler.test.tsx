// @vitest-environment jsdom
import { act, createElement } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";

const addListenerMock = vi.hoisted(() => vi.fn());
const exitAppMock = vi.hoisted(() => vi.fn());
const getPlatformMock = vi.hoisted(() => vi.fn(() => "android"));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: addListenerMock,
    exitApp: exitAppMock,
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: getPlatformMock,
  },
}));

import AndroidBackButtonHandler from "./AndroidBackButtonHandler.js";

beforeEach(() => {
  addListenerMock.mockReset();
  exitAppMock.mockReset();
  getPlatformMock.mockReset();
  getPlatformMock.mockReturnValue("android");
});

function NavigateOnMount({ to }: { to: string | null }) {
  const navigate = useNavigate();
  if (to) {
    queueMicrotask(() => navigate(to));
  }
  return null;
}

describe("AndroidBackButtonHandler listener lifecycle", () => {
  it("registers only one listener even after multiple route changes", async () => {
    addListenerMock.mockReturnValue(Promise.resolve({ remove: vi.fn() }));

    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(AndroidBackButtonHandler),
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/", element: createElement(NavigateOnMount, { to: "/settings" }) }),
          createElement(Route, {
            path: "/settings",
            element: createElement(NavigateOnMount, { to: "/settings/categories" }),
          }),
          createElement(Route, {
            path: "/settings/categories",
            element: createElement(NavigateOnMount, { to: "/settings/categories/abc-123" }),
          }),
          createElement(Route, {
            path: "/settings/categories/:id",
            element: createElement(NavigateOnMount, { to: null }),
          }),
        ),
      ),
    );

    // Let the chained navigates settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(addListenerMock).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("invokes back action using the latest pathname, not the one captured at registration", async () => {
    let backCallback: (() => void) | null = null;
    addListenerMock.mockImplementation((_event: string, cb: () => void) => {
      backCallback = cb;
      return Promise.resolve({ remove: vi.fn() });
    });

    const navigateCalls: Array<[string, unknown]> = [];
    function CaptureNavigate({ to }: { to: string | null }) {
      const navigate = useNavigate();
      if (to) {
        queueMicrotask(() => navigate(to));
      }
      // expose navigate for assertions through a side channel
      (globalThis as typeof globalThis & { __lastNavigate?: (target: string, opts?: unknown) => void }).__lastNavigate =
        (target: string, opts?: unknown) => {
          navigateCalls.push([target, opts]);
          navigate(target, opts as { replace?: boolean });
        };
      return null;
    }

    const { root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(AndroidBackButtonHandler),
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/", element: createElement(CaptureNavigate, { to: "/settings" }) }),
          createElement(Route, {
            path: "/settings",
            element: createElement(CaptureNavigate, { to: "/settings/categories" }),
          }),
          createElement(Route, {
            path: "/settings/categories",
            element: createElement(CaptureNavigate, { to: "/settings/categories/abc-123" }),
          }),
          createElement(Route, {
            path: "/settings/categories/:id",
            element: createElement(CaptureNavigate, { to: null }),
          }),
        ),
      ),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(backCallback).not.toBeNull();
    expect(addListenerMock).toHaveBeenCalledTimes(1);

    // Press back from /settings/categories/abc-123 — should navigate to /settings/categories, NOT to "/"
    await act(async () => {
      backCallback?.();
    });

    // exitApp should NOT have fired (it would only fire if back read pathname as "/")
    expect(exitAppMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("does not register a listener on non-android platforms", async () => {
    getPlatformMock.mockReturnValue("web");
    addListenerMock.mockReturnValue(Promise.resolve({ remove: vi.fn() }));

    const { root } = await renderDom(
      createElement(MemoryRouter, { initialEntries: ["/"] }, createElement(AndroidBackButtonHandler)),
    );

    expect(addListenerMock).not.toHaveBeenCalled();
    await unmount(root);
  });
});
