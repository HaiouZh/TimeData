import { beforeEach, describe, expect, it, vi } from "vitest";

const impactMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const isNativeMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@capacitor/haptics", () => ({
  Haptics: { impact: impactMock },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: isNativeMock } }));

import { hapticDestructive, hapticDrop, hapticGrab, hapticToggle } from "./haptics.ts";

beforeEach(() => {
  impactMock.mockReset();
  impactMock.mockReturnValue(Promise.resolve());
  isNativeMock.mockReset();
  isNativeMock.mockReturnValue(true);
});

describe("haptics 语义层", () => {
  it("勾选用最轻一档", () => {
    hapticToggle();
    expect(impactMock).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("删除用中档", () => {
    hapticDestructive();
    expect(impactMock).toHaveBeenCalledWith({ style: "MEDIUM" });
  });

  it("拖拽起手与落位都用最轻一档", () => {
    hapticGrab();
    hapticDrop();
    expect(impactMock).toHaveBeenCalledTimes(2);
    expect(impactMock).toHaveBeenNthCalledWith(1, { style: "LIGHT" });
    expect(impactMock).toHaveBeenNthCalledWith(2, { style: "LIGHT" });
  });

  it("非原生平台整层空转", () => {
    isNativeMock.mockReturnValue(false);
    hapticToggle();
    hapticDestructive();
    expect(impactMock).not.toHaveBeenCalled();
  });

  it("插件抛错不冒泡", async () => {
    impactMock.mockReturnValue(Promise.reject(new Error("no haptics")));
    expect(() => hapticToggle()).not.toThrow();
    await Promise.resolve();
  });
});
