import { beforeEach, describe, expect, it } from "vitest";
import type { RecoveryKV } from "./kv.js";
import {
  consumeHiddenFlag,
  hiddenMsSinceInMemory,
  hiddenMsSincePersisted,
  markHidden,
  resetLastHidden,
} from "./lastHidden.js";

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

beforeEach(resetLastHidden);

describe("转后台时间戳", () => {
  it("没见过转后台：内存口径为 null、标记为 false", () => {
    expect(hiddenMsSinceInMemory(5000)).toBeNull();
    expect(consumeHiddenFlag()).toBe(false);
  });

  // 逃逸变异：consumeHiddenFlag 读后不清 → 同一次回前台的第二条恢复事件又开一个新会话。
  it("markHidden 后：内存口径算差值，标记消费一次即清", () => {
    const kv = fakeKV();
    markHidden(1000, kv);
    expect(hiddenMsSinceInMemory(4500)).toBe(3500);
    expect(consumeHiddenFlag()).toBe(true);
    expect(consumeHiddenFlag()).toBe(false);
  });

  it("持久化口径：读上一个页面写下的时间；缺失 / 非法 / 来自未来为 null", () => {
    const kv = fakeKV();
    markHidden(1000, kv);
    expect(hiddenMsSincePersisted(61_000, kv)).toBe(60_000);
    expect(hiddenMsSincePersisted(1000, fakeKV())).toBeNull();
    expect(hiddenMsSincePersisted(1000, fakeKV({ timedata_last_hidden_at: "坏" }))).toBeNull();
    expect(hiddenMsSincePersisted(500, fakeKV({ timedata_last_hidden_at: "1000" }))).toBeNull();
  });

  it("时钟回拨时内存口径夹到 0", () => {
    markHidden(9000, fakeKV());
    expect(hiddenMsSinceInMemory(8000)).toBe(0);
  });
});
