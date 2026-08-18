import { describe, expect, it } from "vitest";
import type { RecoveryKV } from "./kv.js";
import {
  TOMBSTONE_FRESHNESS_MS,
  attributeReload,
  consumeTombstone,
  markReload,
  readTombstone,
} from "./reloadAttribution.js";

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

describe("墓碑读写", () => {
  it("写进去再读出来", () => {
    const kv = fakeKV();
    markReload("watchdog", 1000, kv);
    expect(readTombstone(kv)).toEqual({ at: 1000, by: "watchdog" });
  });

  it("消费后读不到", () => {
    const kv = fakeKV();
    markReload("update", 1000, kv);
    consumeTombstone(kv);
    expect(readTombstone(kv)).toBeNull();
  });

  it("坏 JSON / 缺字段 / 不认的 by 一律当没有", () => {
    expect(readTombstone(fakeKV({ timedata_reload_tombstone: "{坏" }))).toBeNull();
    expect(readTombstone(fakeKV({ timedata_reload_tombstone: '{"by":"watchdog"}' }))).toBeNull();
    expect(readTombstone(fakeKV({ timedata_reload_tombstone: '{"at":1,"by":"其他"}' }))).toBeNull();
  });
});

describe("重载归因", () => {
  it("不是 reload 就是正常冷启动", () => {
    expect(attributeReload("navigate", null, 1000)).toBe("cold");
    expect(attributeReload("back_forward", { at: 999, by: "watchdog" }, 1000)).toBe("cold");
  });

  it("reload + 新鲜墓碑 → 归给写墓碑的那条主动路径", () => {
    expect(attributeReload("reload", { at: 1000, by: "watchdog" }, 1500)).toBe("watchdog");
    expect(attributeReload("reload", { at: 1000, by: "update" }, 1500)).toBe("update");
  });

  it("reload + 无墓碑 → 外部重载（渲染进程被回收）", () => {
    expect(attributeReload("reload", null, 1500)).toBe("external");
  });

  it("reload + 过期墓碑 → 外部重载", () => {
    const stale = { at: 1000, by: "watchdog" as const };
    expect(attributeReload("reload", stale, 1000 + TOMBSTONE_FRESHNESS_MS)).toBe("watchdog"); // 边界内
    expect(attributeReload("reload", stale, 1001 + TOMBSTONE_FRESHNESS_MS)).toBe("external");
  });

  it("时钟回拨导致墓碑在未来 → 不认，算外部重载", () => {
    expect(attributeReload("reload", { at: 5000, by: "watchdog" }, 1000)).toBe("external");
  });
});
