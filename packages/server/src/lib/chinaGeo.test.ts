import { afterEach, describe, expect, it, vi } from "vitest";
import { isChinaTableReady, lookupChinaGeo, resetChinaGeoForTests } from "./chinaGeo.js";

afterEach(() => {
  resetChinaGeoForTests();
});

// 用真实的 china-geo.bin —— 它只有 750KB、随仓库走，CI 里也在。
// 这是本仓第一次能真跑中国归属地路径（70MB 的 GeoLite2 进不了 CI，只能 mock）。
describe("中国段表查找（真实数据）", () => {
  it.each([
    ["112.25.1.1", "江苏省", "南京市", "中国移动"],
    ["111.13.2.1", "北京", "北京市", "中国移动"],
    ["221.176.1.1", "北京", "北京市", "中国移动"],
    ["223.104.5.1", "上海", "上海市", "中国移动"],
    ["183.193.1.1", "上海", "上海市", "中国移动"],
    ["120.1.2.3", "河北省", "石家庄市", "中国联通"],
  ])("%s → %s %s %s", (ip, province, city, isp) => {
    expect(lookupChinaGeo(ip)).toEqual({ province, city, isp });
  });

  // 香港 5802 个段的市与运营商在源数据里都是 0(真实段 1.32.192.0-1.32.206.255)。
  // 这是「有省无市」这一档的现实来源,收敛键要靠它避免掉进最宽的 asn: 档。
  it("香港段只有省，市与运营商为 null", () => {
    expect(lookupChinaGeo("1.32.192.1")).toEqual({ province: "香港特别行政区", city: null, isp: null });
  });

  // 真实段 1.1.0.0-1.1.0.255：有市但运营商是 0
  it("运营商未知时 isp 为 null，省市照常", () => {
    expect(lookupChinaGeo("1.1.0.1")).toEqual({ province: "福建省", city: "福州市", isp: null });
  });

  // 相邻区间的真实边界：112.25.0.0-112.25.63.255 南京，112.25.64.0-112.25.95.255 无锡。
  // 二分查找写错 ±1 时这两条会串。
  it("区间边界不串档", () => {
    expect(lookupChinaGeo("112.25.63.255")).toMatchObject({ city: "南京市" });
    expect(lookupChinaGeo("112.25.64.0")).toMatchObject({ city: "无锡市" });
  });

  it("国外 IP 不命中", () => {
    expect(lookupChinaGeo("8.8.8.8")).toBeNull();
    expect(lookupChinaGeo("1.1.1.1")).toBeNull();
  });

  it("非 IPv4 输入返回 null 而不抛", () => {
    expect(lookupChinaGeo("not-an-ip")).toBeNull();
    expect(lookupChinaGeo("2001:db8::1")).toBeNull();
    expect(lookupChinaGeo("999.1.1.1")).toBeNull();
  });

  it("表就绪状态为真", () => {
    expect(isChinaTableReady()).toBe(true);
  });
});

describe("表文件缺失时降级", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("读不到文件时返回 null 而不抛，就绪状态为假", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      readFileSync: vi.fn(() => {
        throw new Error("ENOENT（测试桩）");
      }),
    }));
    const mod = await import("./chinaGeo.js");
    expect(mod.lookupChinaGeo("112.25.1.1")).toBeNull();
    expect(mod.isChinaTableReady()).toBe(false);
  });

  it("magic 不对时按缺表处理，不抛", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      readFileSync: vi.fn(() => Buffer.from("NOPE________________")),
    }));
    const mod = await import("./chinaGeo.js");
    expect(mod.lookupChinaGeo("112.25.1.1")).toBeNull();
    expect(mod.isChinaTableReady()).toBe(false);
  });
});
