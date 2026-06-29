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
