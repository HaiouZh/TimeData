import { describe, expect, it } from "vitest";
import type { DesktopHotkeyEvent } from "./api.js";
import { resolveNavigateTarget } from "./navigateAction.js";

function event(target?: string): DesktopHotkeyEvent {
  return { action: "navigate", pressedAtMs: 0, target };
}

describe("resolveNavigateTarget", () => {
  it("给出白名单内的目标页", () => {
    expect(resolveNavigateTarget(event("/todo"), "/diary")).toBe("/todo");
  });

  it("已经在目标页时不跳", () => {
    // 不只是实现「同页再按什么都不干」：navigate() 到当前路径会往 history 压一条重复条目，
    // 压多了返回键要按很多次才退得出去。
    expect(resolveNavigateTarget(event("/todo"), "/todo")).toBeNull();
  });

  it("同页判据是逐字相等：带 query 的 currentPath 会被判成另一页", () => {
    // 这条锁的是契约方向：函数假设入参已剥掉 query。调用方传 pathname+search
    // 会走进这里的「不同页」分支——真正防住它的是 DesktopBridge 那条 dom 测试。
    expect(resolveNavigateTarget(event("/"), "/?date=2026-08-07")).toBe("/");
  });

  it("白名单外的目标丢弃", () => {
    // 手改配置文件、或上游把某个路由改了名，都会落到这里。
    expect(resolveNavigateTarget(event("/nope"), "/diary")).toBeNull();
  });

  it("target 缺失时丢弃", () => {
    // Rust 保证 navigate 必带非空 target，此判纯防御（载荷类型上仍可为空）。
    expect(resolveNavigateTarget(event(undefined), "/diary")).toBeNull();
  });

  it("非 navigate 动作一律不产出目标", () => {
    // **必须带上一个合法 target**：不带的话这条用例会被 `!target` 那一支兜住、根本走不到
    // action 判断，于是「删掉 action 判断」这个变异杀不死它——实测过，那正是它作为假闸
    // 放行了一次真实缺失的方式。
    expect(resolveNavigateTarget({ action: "punch", pressedAtMs: 0, target: "/todo" }, "/diary")).toBeNull();
  });
});
