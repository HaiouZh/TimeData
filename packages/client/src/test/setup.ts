import { afterEach, vi } from "vitest";

// 全局测试清理收口：unit project 的所有测试 afterEach 自动跑。
// 关键：unit project 不设全局 environment，纯逻辑测试跑在 node 下（无 localStorage/document/indexedDB），
// 故每项都 typeof 守卫，且 Dexie 用动态 import——避免给纯逻辑测试平白加上 db/dexie 的 import 开销。
afterEach(async () => {
  // 定时器复位（21 个文件用 fake timers，防泄漏到下个测试）
  vi.useRealTimers();
  // mock / spy 复位
  vi.restoreAllMocks();
  // localStorage 清空
  if (typeof localStorage !== "undefined") localStorage.clear();
  // DOM 残留清理（裸 createRoot 未 unmount 的兜底）
  if (typeof document !== "undefined") document.body.innerHTML = "";
  // Dexie 全表清空（泛化遍历 db.tables，schema 加表自动覆盖）
  // 若测试本身调用了 db.delete()，db 已关闭，跳过避免 DatabaseClosedError
  if (typeof indexedDB !== "undefined") {
    const { db } = await import("../db/index.js");
    if (db.isOpen()) {
      await Promise.all(db.tables.map((t) => t.clear()));
    }
  }
});
