// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateProvider } from "./appUpdate.js";
import { renderDom, unmount } from "./test/domHarness.js";
import { getLastRegisterOptions, resetPwaRegisterMock } from "./test/pwaRegisterMock.js";

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
    const { root } = await renderDom(createElement(AppUpdateProvider, null, "内容"));

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

    await unmount(root);

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(secondRegistration.update).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockRestore();
  });

  it("does not start update polling when the service worker registration resolves after unmount", async () => {
    const registration = { update: vi.fn() };
    const { root } = await renderDom(createElement(AppUpdateProvider, null, "内容"));

    const registerOptions = getLastRegisterOptions();
    expect(registerOptions?.onRegisteredSW).toBeTypeOf("function");

    await unmount(root);

    act(() => {
      registerOptions?.onRegisteredSW?.("/sw.js", registration);
    });

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(registration.update).not.toHaveBeenCalled();
  });
});
