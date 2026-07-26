import { afterEach, vi } from "vitest";

// 全局测试清理收口：unit project 的所有测试 afterEach 自动跑。
// 关键：unit project 不设全局 environment，纯逻辑测试跑在 node 下（无 localStorage/document/indexedDB），
// 故每项都 typeof 守卫，且 Dexie 用动态 import——避免给纯逻辑测试平白加上 db/dexie 的 import 开销。
afterEach(async () => {
  // 定时器复位（21 个文件用 fake timers，防泄漏到下个测试）
  vi.useRealTimers();
  // mock / spy 复位。两条缺一不可：Vitest 3 起 restoreAllMocks 只还原 vi.spyOn 装的间谍，
  // 不再清 vi.fn() 的调用历史（含 vi.mock 工厂里造的那些）。少了 clearAllMocks，
  // 「上一条用例调用过某 mock」就会泄漏成下一条的 toHaveBeenCalled 脏数据。
  vi.restoreAllMocks();
  vi.clearAllMocks();
  // 全局 stub 复位：撤销 vi.stubGlobal 注入的全局（restoreAllMocks 撤不掉它）；
  // 防止 no-isolate 下 stub 的 fetch/Date/IntersectionObserver/rAF 等永久挂在 worker globalThis 上跨文件串味。
  vi.unstubAllGlobals();
  // localStorage 清空
  if (typeof localStorage !== "undefined") localStorage.clear();
  // React root 卸载 + DOM 残留清理。两步缺一不可：只清 innerHTML 不卸 root，页面组件（连同它的
  // useLiveQuery 订阅）会永久留活——页面级用例把 unmount(root) 写在最后一句，任一断言先失败就走不到，
  // 之后每条用例开头的 db.*.clear() 都会驱动这些僵尸页重渲染，把一条失败放大成后续用例的连带超时。
  // cleanupRoots 幂等（已手动 unmount 的 root 不在 activeRoots 里）；动态 import 避免给
  // 纯逻辑（node 环境）测试平白加上 react-dom 的 import 开销。
  if (typeof document !== "undefined") {
    const { cleanupRoots } = await import("./domHarness.js");
    await cleanupRoots();
    document.body.innerHTML = "";
  }
  // Dexie 全表清空（泛化遍历 db.tables，schema 加表自动覆盖）
  // 若测试本身调用了 db.delete()，db 已关闭，跳过避免 DatabaseClosedError
  if (typeof indexedDB !== "undefined") {
    const { db } = await import("../db/index.js");
    if (db.isOpen()) {
      await Promise.all(db.tables.map((t) => t.clear()));
    }
  }
});
