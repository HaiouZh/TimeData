// 必须在任何 dexie 模块求值前注册：Dexie 在 dexie 模块加载时即把 globalThis.indexedDB 存入 Dexie.dependencies。
// isolate:false 下文件加载顺序随机（纯逻辑文件经 lib→db/index 也会间接加载 dexie），
// 只有在 setupFile 顶部统一注册 fake-idb，才能保证 dexie 永远捕获到（fake 的）indexedDB，db 测试方可入此桶。
import "fake-indexeddb/auto";
import { afterEach, vi } from "vitest";

// 干净桶（unit-clean，isolate:false、node 环境）的精简清理。
// 干净桶文件不碰 db / 不碰 DOM / 不 stubGlobal（边界由 pnpm check:test 守），
// 故无需 fake-indexeddb 与 DOM 兜底；只复位会在 no-isolate 下跨文件泄漏的 vitest 态。
afterEach(() => {
  // 定时器复位（部分纯逻辑测试用 fake timers，防泄漏到下个测试）
  vi.useRealTimers();
  // mock / spy 复位
  vi.restoreAllMocks();
  // 全局 stub 兜底复位（干净桶本不应 stubGlobal，仍保留以防万一）
  vi.unstubAllGlobals();
});
