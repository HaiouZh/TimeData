import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookupGeo, resetGeoipForTests } from "./geoip.js";

const originalDir = process.env.GEOIP_DIR;

beforeEach(() => {
  resetGeoipForTests();
});

afterEach(() => {
  if (originalDir === undefined) delete process.env.GEOIP_DIR;
  else process.env.GEOIP_DIR = originalDir;
  resetGeoipForTests();
});

describe("geoip 缺库降级", () => {
  it("mmdb 目录不存在时返回 null 而不抛", () => {
    process.env.GEOIP_DIR = "/nonexistent/geoip-dir-for-tests";
    expect(lookupGeo("203.0.113.9")).toBeNull();
  });

  it("非法 IP 字符串返回 null", () => {
    process.env.GEOIP_DIR = "/nonexistent/geoip-dir-for-tests";
    expect(lookupGeo("not-an-ip")).toBeNull();
  });

  it("缺库时重复调用仍返回 null（缓存住失败结果，不反复读盘）", () => {
    process.env.GEOIP_DIR = "/nonexistent/geoip-dir-for-tests";
    expect(lookupGeo("203.0.113.9")).toBeNull();
    expect(lookupGeo("198.51.100.1")).toBeNull();
  });

  // 上一条只断了返回值，缓存去掉它照样绿；这条数真实读盘次数，才是缓存的守卫。
  // mock connection 后动态 import 的写法照抄 knownIps.test.ts。
  it("加载结果被缓存：两次查询只读盘 2 次（City+ASN），reset 后才重新读", async () => {
    process.env.GEOIP_DIR = "/nonexistent/geoip-dir-for-tests";
    const readFileSyncSpy = vi.fn(() => {
      throw new Error("ENOENT: mmdb 不存在（测试桩）");
    });
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      readFileSync: readFileSyncSpy,
    }));

    try {
      const geoip = await import("./geoip.js");

      expect(geoip.lookupGeo("203.0.113.9")).toBeNull();
      expect(readFileSyncSpy).toHaveBeenCalledTimes(2);

      expect(geoip.lookupGeo("198.51.100.1")).toBeNull();
      expect(readFileSyncSpy).toHaveBeenCalledTimes(2);

      geoip.resetGeoipForTests();
      expect(geoip.lookupGeo("203.0.113.9")).toBeNull();
      expect(readFileSyncSpy).toHaveBeenCalledTimes(4);
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});
