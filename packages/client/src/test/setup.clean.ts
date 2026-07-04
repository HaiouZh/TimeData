// 必须在任何 dexie 模块求值前注册：Dexie 在 dexie 模块加载时即把 globalThis.indexedDB 存入 Dexie.dependencies。
// isolate:false 下文件加载顺序随机（纯逻辑文件经 lib→db/index 也会间接加载 dexie），
// 只有在 setupFile 顶部统一注册 fake-idb，才能保证 dexie 永远捕获到（fake 的）indexedDB，db 测试方可入此桶。
import "fake-indexeddb/auto";
import { afterEach, vi } from "vitest";

// 桶级内存 localStorage：node 环境本无 localStorage，此前每个 prefs/settings 测试各自
// defineProperty(globalThis) 注入（= 脏标记，被挡在快桶外）。收口成 setup 统一提供 + afterEach 清空，
// 测试文件零注入即可直用 localStorage，自然通过 node 派生桶判定。
const memoryStorage = (() => {
  let store = new Map<string, string>();
  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true });

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
  // 桶级 localStorage 清空（防跨文件串键）
  localStorage.clear();
});
