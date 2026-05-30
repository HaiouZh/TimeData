// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLastRegisterOptions, resetPwaRegisterMock } from "./test/pwaRegisterMock.js";
import { AppUpdateProvider } from "./appUpdate.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AppUpdateProvider PWA update polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPwaRegisterMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears stale update polling when the service worker registers again and when the provider unmounts", async () => {
    const firstRegistration = { update: vi.fn() };
    const secondRegistration = { update: vi.fn() };
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(AppUpdateProvider, null, "内容"));
    });

    const registerOptions = getLastRegisterOptions();
    expect(registerOptions?.onRegisteredSW).toBeTypeOf("function");

    act(() => {
      registerOptions?.onRegisteredSW?.("/sw.js", firstRegistration);
    });

    act(() => {
      registerOptions?.onRegisteredSW?.("/sw.js", secondRegistration);
    });

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(firstRegistration.update).not.toHaveBeenCalled();
    expect(secondRegistration.update).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(secondRegistration.update).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockRestore();
    container.remove();
  });

  it("does not start update polling when the service worker registration resolves after unmount", async () => {
    const registration = { update: vi.fn() };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(AppUpdateProvider, null, "内容"));
    });

    const registerOptions = getLastRegisterOptions();
    expect(registerOptions?.onRegisteredSW).toBeTypeOf("function");

    await act(async () => {
      root.unmount();
    });

    act(() => {
      registerOptions?.onRegisteredSW?.("/sw.js", registration);
    });

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(registration.update).not.toHaveBeenCalled();

    container.remove();
  });
});
