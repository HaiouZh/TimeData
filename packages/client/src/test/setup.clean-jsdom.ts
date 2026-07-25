// jsdom 快桶（unit-clean-jsdom，isolate:false、jsdom 环境）的清理收口。
// 必须在任何 dexie 模块求值前注册 fake-idb（理由同 setup.clean.ts）：本桶含洗白后的 db 测试。
import "fake-indexeddb/auto";
import { afterEach, vi } from "vitest";
import { cleanupRoots } from "./domHarness.js";

// 本桶是 allowlist 准入（test-buckets.fast-jsdom.json），每个文件都过了「isolate:false + shuffle×5」硬闸。
// afterEach 把会在 no-isolate 下跨文件串味的副作用全部复位：
afterEach(async () => {
  // 定时器复位
  vi.useRealTimers();
  // mock / spy 复位。两条缺一不可：Vitest 3 起 restoreAllMocks 只还原 vi.spyOn 装的间谍，
  // 不再清 vi.fn() 的调用历史（含 vi.mock 工厂里造的那些）。少了 clearAllMocks，
  // 「上一条用例调用过某 mock」就会泄漏成下一条的 toHaveBeenCalled 脏数据——
  // 默认顺序下可能恒绿，shuffle 一换序就随机翻车。
  vi.restoreAllMocks();
  vi.clearAllMocks();
  // 全局 stub 复位（vi.stubGlobal 注入的全局，restoreAllMocks 撤不掉）
  vi.unstubAllGlobals();
  // 卸载未手动 unmount 的 React root（治 root/Provider 残留泄漏）
  await cleanupRoots();
  // localStorage 清空
  if (typeof localStorage !== "undefined") localStorage.clear();
  // DOM 残留兜底（cleanupRoots 已摘 harness host；非 harness 遗留节点再清一次）
  if (typeof document !== "undefined") document.body.innerHTML = "";
  // Dexie 排干 + 全表清空（batch B 的 db 测试用；await 把浮动写冲掉再清）
  const { db } = await import("../db/index.js");
  if (db.isOpen()) {
    await Promise.all(db.tables.map((t) => t.clear()));
  }
});
