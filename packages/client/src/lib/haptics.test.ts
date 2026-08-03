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

  // 下面三条各守一种「触感把业务动作炸掉」的路径。上一版只有一条 `expect(...).not.toThrow()`，
  // 而 impact 本来就不会同步抛——那是条永不发生的守卫，去掉 .catch 也照样绿（终审实测）。
  it("给插件返回的 promise 挂上拒绝兜底（系统关掉触感 = 一条 reject，不该冒出来）", () => {
    // 刻意不去观测「有没有未处理拒绝」：node 判定它要跨好几轮宏任务，在本仓 unit 桶里实测抓不到，
    // 写出来就是又一条永远绿的假闸。改为直接钉住可观测的契约——兜底 handler 必须挂上去，且它得吞掉错。
    const then = vi.fn();
    impactMock.mockReturnValue({ then } as unknown as Promise<void>);

    hapticToggle();

    expect(then).toHaveBeenCalledTimes(1);
    const onRejected = then.mock.calls[0]?.[1] as ((reason: unknown) => void) | undefined;
    expect(typeof onRejected).toBe("function");
    expect(() => onRejected?.(new Error("no haptics"))).not.toThrow();
  });

  it("插件返回非 thenable（未注册 / 旧桥 shim）时不同步抛：拖拽与勾选不能被触感拖垮", () => {
    // 直接 `.catch` 挂在返回值上时这里是同步 TypeError。hapticGrab 在 dnd-kit 的同步
    // onDragStart 里调，抛出去整个拖拽起不来；hapticToggle 抛则勾选毫无反应。
    impactMock.mockReturnValue(undefined as unknown as Promise<void>);
    expect(() => hapticGrab()).not.toThrow();
    expect(() => hapticToggle()).not.toThrow();
  });

  it("插件本身同步抛（Capacitor 插件未实现）时也不冒泡", () => {
    impactMock.mockImplementation(() => {
      throw new Error("Haptics plugin is not implemented on ios");
    });
    expect(() => hapticDestructive()).not.toThrow();
  });
});
