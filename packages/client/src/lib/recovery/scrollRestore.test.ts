import { describe, expect, it } from "vitest";
import type { RecoveryKV } from "./kv.js";
import {
  SCROLL_POSITIONS_MAX,
  canRestoreScroll,
  isRestoreExpired,
  readScrollTop,
  writeScrollTop,
} from "./scrollRestore.js";

function fakeKV(initial: Record<string, string> = {}): RecoveryKV {
  const store = { ...initial };
  return {
    get: (key) => store[key] ?? null,
    set: (key, value) => {
      store[key] = value;
    },
    remove: (key) => {
      delete store[key];
    },
  };
}

describe("scrollRestore 存取", () => {
  it("写进去再读出来", () => {
    const kv = fakeKV();
    writeScrollTop("/todo", 420, kv);
    expect(readScrollTop("/todo", kv)).toBe(420);
  });

  it("没存过的路径读出 null", () => {
    expect(readScrollTop("/todo", fakeKV())).toBeNull();
  });

  it("坏 JSON 当空处理，不抛", () => {
    const kv = fakeKV({ timedata_scroll_positions: "{不是 json" });
    expect(readScrollTop("/todo", kv)).toBeNull();
  });

  it("负数与非有限值不写入", () => {
    const kv = fakeKV();
    writeScrollTop("/todo", -1, kv);
    writeScrollTop("/todo", Number.NaN, kv);
    expect(readScrollTop("/todo", kv)).toBeNull();
  });

  it("小数取整", () => {
    const kv = fakeKV();
    writeScrollTop("/todo", 12.7, kv);
    expect(readScrollTop("/todo", kv)).toBe(13);
  });

  it("超量时裁掉最旧的，保留最近写的", () => {
    const kv = fakeKV();
    for (let i = 0; i < SCROLL_POSITIONS_MAX + 2; i += 1) writeScrollTop(`/p${i}`, i + 1, kv);
    expect(readScrollTop("/p0", kv)).toBeNull();
    expect(readScrollTop("/p1", kv)).toBeNull();
    expect(readScrollTop(`/p${SCROLL_POSITIONS_MAX + 1}`, kv)).toBe(SCROLL_POSITIONS_MAX + 2);
  });

  it("重写同一路径不占新坑，仍算最近使用", () => {
    const kv = fakeKV();
    writeScrollTop("/a", 1, kv);
    for (let i = 0; i < SCROLL_POSITIONS_MAX - 1; i += 1) writeScrollTop(`/x${i}`, 9, kv);
    writeScrollTop("/a", 2, kv); // 刷新 /a 的位置到队尾
    writeScrollTop("/last", 3, kv); // 挤掉最旧的一条，但不该是 /a
    expect(readScrollTop("/a", kv)).toBe(2);
  });
});

describe("scrollRestore 恢复判定", () => {
  it("内容够高才滚得到目标位", () => {
    expect(canRestoreScroll(500, 1400, 900)).toBe(true); // 500 + 900 = 1400，刚好够
    expect(canRestoreScroll(500, 1399, 900)).toBe(false); // 差 1px，再等
  });

  it("超时就放弃，不硬滚", () => {
    expect(isRestoreExpired(1000, 2999)).toBe(false);
    expect(isRestoreExpired(1000, 3000)).toBe(true);
  });
});
