import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geoDisplayCity, lookupGeo, resetGeoipForTests } from "./geoip.js";

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

  // 注意:缺库时这条走的是「mmdb 读盘失败 + 中国表查询后返回 null」的完整路径,
  // 并不守护 validate() 短路本身——真闸在下面「库就绪」组里(库在时才走得到 validate)。
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
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        // 中国段表放行真实读盘:它随仓库走,且这条守的是 mmdb 读盘缓存,不该被它搅计数
        readFileSync: vi.fn((filePath: string, ...rest: unknown[]) => {
          if (String(filePath).endsWith("china-geo.bin")) {
            return (actual.readFileSync as (...args: unknown[]) => Buffer)(filePath, ...rest);
          }
          return readFileSyncSpy(filePath);
        }),
      };
    });

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

/**
 * 库就绪路径。真 mmdb 有 70MB、不进仓库,但 lookupGeo 只用到 Reader 的 .get(),
 * 所以 mock 掉 maxmind 就能覆盖整段成功路径(zh-CN 优先、geonameId、validate 短路、
 * 半加载态),不需要给生产代码开任何测试专用缝。
 */
type FakeRows = { city?: unknown; asn?: unknown };

async function loadGeoipWithFakeReaders(rows: FakeRows, opts: { cityOk?: boolean; asnOk?: boolean } = {}) {
  const { cityOk = true, asnOk = true } = opts;
  const validateSpy = vi.fn((ip: string) => /^[0-9a-fA-F:.]+$/.test(ip));

  vi.resetModules();
  vi.doMock("node:fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs")>();
    return {
      ...actual,
      // buffer 内容带库名标记,让 Reader 桩能认出自己是哪个库——不能靠构造顺序,
      // 因为某个库加载失败时它的 Reader 压根不会被构造。
      readFileSync: vi.fn((filePath: string, ...rest: unknown[]) => {
        // 中国段表走真实读盘:它随仓库走、CI 里也在,劫持它会让中国路径整片假降级
        if (String(filePath).endsWith("china-geo.bin")) {
          return (actual.readFileSync as (...args: unknown[]) => Buffer)(filePath, ...rest);
        }
        const isCity = String(filePath).includes("City");
        if (isCity ? !cityOk : !asnOk) throw new Error("ENOENT（测试桩）");
        return Buffer.from(isCity ? "city" : "asn");
      }),
    };
  });
  vi.doMock("maxmind", () => ({
    validate: validateSpy,
    Reader: class {
      #isCity: boolean;
      constructor(buf: Buffer, _opts?: unknown) {
        this.#isCity = buf.toString() === "city";
      }
      get(_ip: string) {
        return this.#isCity ? (rows.city ?? null) : (rows.asn ?? null);
      }
    },
  }));

  const geoip = await import("./geoip.js");
  return { geoip, validateSpy };
}

const CITY_ROW = {
  country: { names: { en: "China", "zh-CN": "中国" } },
  city: { geoname_id: 1796236, names: { en: "Shanghai", "zh-CN": "上海" } },
};
const ASN_ROW = { autonomous_system_number: 9808, autonomous_system_organization: "China Mobile" };

describe("geoip 库就绪时的查询", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.doUnmock("maxmind");
    vi.resetModules();
  });

  it("两库都在:返回中文地名、geonameId 与运营商", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW });
    expect(geoip.lookupGeo("203.0.113.9")).toEqual({
      country: "中国",
      region: null,
      city: "上海",
      cityGeonameId: 1796236,
      asn: 9808,
      asnOrg: "China Mobile",
    });
  });

  it("地名优先 zh-CN,缺中文名时回落 en", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({
      city: { country: { names: { en: "Canada" } }, city: { geoname_id: 6058560, names: { en: "London" } } },
      asn: ASN_ROW,
    });
    expect(geoip.lookupGeo("203.0.113.9")).toMatchObject({ country: "Canada", city: "London" });
  });

  it("库在时非法 IP 被 validate 短路挡下,不查库", async () => {
    const { geoip, validateSpy } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW });
    expect(geoip.lookupGeo("not-an-ip")).toBeNull();
    expect(validateSpy).toHaveBeenCalledWith("not-an-ip");
  });

  it("两库都查不到该 IP 时返回 null", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({});
    expect(geoip.lookupGeo("203.0.113.9")).toBeNull();
  });

  it("半加载态:只有 ASN 库在 → 有运营商无地名,就绪状态如实报告", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW }, { cityOk: false });
    expect(geoip.lookupGeo("203.0.113.9")).toMatchObject({
      country: null, city: null, cityGeonameId: null, asn: 9808,
    });
    expect(geoip.getGeoipReadiness()).toEqual({ city: false, asn: true, chinaTable: true });
  });

  it("半加载态:只有 City 库在 → 有地名无运营商", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW }, { asnOk: false });
    expect(geoip.lookupGeo("203.0.113.9")).toMatchObject({
      country: "中国", city: "上海", asn: null, asnOrg: null,
    });
    expect(geoip.getGeoipReadiness()).toEqual({ city: true, asn: false, chinaTable: true });
  });

  it("两库都在时就绪状态全 true", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW });
    expect(geoip.getGeoipReadiness()).toEqual({ city: true, asn: true, chinaTable: true });
  });
});

describe("中国表命中优先", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.doUnmock("maxmind");
    vi.resetModules();
  });

  it("中国 IP 用中国表的中文省市与运营商，ASN 号仍取自 GeoLite2-ASN", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW });
    expect(geoip.lookupGeo("112.25.1.1")).toEqual({
      country: "中国",
      region: "江苏省",
      city: "南京市",
      cityGeonameId: null,
      asn: 9808,
      asnOrg: "中国移动",
    });
  });

  // 中国表只在中国段命中,国外必须原样走 GeoLite2 —— 这条守的是「国外路径一行不改」。
  // 断言里的「中国 / 上海」是 CITY_ROW 桩数据,不是说 8.8.8.8 在中国:重点是 region 为
  // null、cityGeonameId 有值,证明它没被中国表接管。
  it("未命中中国表的 IP 仍走 GeoLite2 且 region 为 null", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW });
    expect(geoip.lookupGeo("8.8.8.8")).toEqual({
      country: "中国", region: null, city: "上海", cityGeonameId: 1796236, asn: 9808, asnOrg: "China Mobile",
    });
  });

  // 中国表内置随镜像走,GeoLite2 要手动放;本地开发/CI 常态就是「有中国表没 mmdb」。
  // 这条同时守住「lookupGeo 里那句 if (!city && !asn) return null 早退必须删掉」。
  it("GeoLite2 全缺但中国表在：中国 IP 仍有省市，ASN 为 null", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({}, { cityOk: false, asnOk: false });
    expect(geoip.lookupGeo("112.25.1.1")).toMatchObject({
      country: "中国", region: "江苏省", city: "南京市", asn: null,
    });
  });

  // 真实段 1.1.0.0-1.1.0.255：福州,源数据里运营商是 0 → 归一后 null → 回落 GeoLite2
  it("中国表命中但运营商未知时回落 GeoLite2 的 asnOrg", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW });
    expect(geoip.lookupGeo("1.1.0.1")).toEqual({
      country: "中国", region: "福建省", city: "福州市", cityGeonameId: null, asn: 9808, asnOrg: "China Mobile",
    });
  });

  // 香港段：省有、市无、运营商无
  it("香港段只有省时 city 为 null", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW });
    expect(geoip.lookupGeo("1.32.192.1")).toMatchObject({
      country: "中国", region: "香港特别行政区", city: null, asnOrg: "China Mobile",
    });
  });

  it("就绪状态多报一路中国表", async () => {
    const { geoip } = await loadGeoipWithFakeReaders({ city: CITY_ROW, asn: ASN_ROW });
    expect(geoip.getGeoipReadiness()).toEqual({ city: true, asn: true, chinaTable: true });
  });
});

describe("geoDisplayCity", () => {
  it("省市都有时拼成一串", () => {
    expect(geoDisplayCity({ country: "中国", region: "江苏省", city: "南京市", cityGeonameId: null, asn: null, asnOrg: null }))
      .toBe("江苏省 南京市");
  });

  // 直辖市归一后省=北京、市=北京市,不去重会打出「北京 北京市」
  it("省是市的前缀时只出一个", () => {
    expect(geoDisplayCity({ country: "中国", region: "北京", city: "北京市", cityGeonameId: null, asn: null, asnOrg: null }))
      .toBe("北京市");
  });

  // 香港 5802 个段的城市字段全是空
  it("只有省时出省", () => {
    expect(geoDisplayCity({ country: "中国", region: "香港特别行政区", city: null, cityGeonameId: null, asn: null, asnOrg: null }))
      .toBe("香港特别行政区");
  });

  // 空串 city 等同无市,不能打出「江苏省 」尾随空格
  it("空串 city 按无市处理,只出省", () => {
    expect(geoDisplayCity({ country: "中国", region: "江苏省", city: "", cityGeonameId: null, asn: null, asnOrg: null }))
      .toBe("江苏省");
  });

  it("GeoLite2 路径原样返回城市", () => {
    expect(geoDisplayCity({ country: "美国", region: null, city: "San Jose", cityGeonameId: 5392171, asn: null, asnOrg: null }))
      .toBe("San Jose");
  });

  it("两者都无时返回 null", () => {
    expect(geoDisplayCity({ country: "中国", region: null, city: null, cityGeonameId: null, asn: null, asnOrg: null }))
      .toBeNull();
  });
});
