import { describe, expect, it } from "vitest";
import type { GeoLookup } from "./geoip.js";
import { computeIpScope } from "./ipScope.js";

const SHANGHAI_MOBILE: GeoLookup = {
  country: "中国",
  region: null,
  city: "上海",
  cityGeonameId: 1796236,
  asn: 9808,
  asnOrg: "China Mobile",
};

describe("computeIpScope 三档收敛", () => {
  it("有 ASN 且有城市:按 asn+geonameId 收敛,同范围换 IP 得同一个键", () => {
    const a = computeIpScope("203.0.113.9", SHANGHAI_MOBILE);
    const b = computeIpScope("203.0.113.77", SHANGHAI_MOBILE);
    expect(a.scopeKey).toBe("asn:9808|geo:1796236");
    expect(b.scopeKey).toBe(a.scopeKey);
    expect(a).toMatchObject({ country: "中国", city: "上海", asnOrg: "China Mobile" });
  });

  it("有 ASN 无城市:退回只用 asn,不拼空城市", () => {
    const scope = computeIpScope("203.0.113.9", {
      country: "美国", region: null, city: null, cityGeonameId: null, asn: 14061, asnOrg: "DigitalOcean",
    });
    expect(scope.scopeKey).toBe("asn:14061");
    expect(scope.city).toBeNull();
  });

  it("换城市算不同范围,换 ASN 也算不同范围", () => {
    const nanjing = computeIpScope("203.0.113.9", { ...SHANGHAI_MOBILE, city: "南京", cityGeonameId: 1799962 });
    const unicom = computeIpScope("203.0.113.9", { ...SHANGHAI_MOBILE, asn: 4837, asnOrg: "China Unicom" });
    expect(nanjing.scopeKey).not.toBe("asn:9808|geo:1796236");
    expect(unicom.scopeKey).not.toBe("asn:9808|geo:1796236");
  });

  it("键用 geonameId 而非城市名:换库导致地名本地化变化时,已确认范围不重报", () => {
    // 同一物理城市,mmdb 换构建后 zh-CN 名缺失、回落成英文名。
    const zh = computeIpScope("203.0.113.9", SHANGHAI_MOBILE);
    const en = computeIpScope("203.0.113.9", { ...SHANGHAI_MOBILE, city: "Shanghai" });
    expect(en.scopeKey).toBe(zh.scopeKey);
    // 显示字段仍跟着库走,只有键是稳定的。
    expect(en.city).toBe("Shanghai");
  });

  it("键用 geonameId:同一 ASN 下同名不同国的城市不会被并成一个键", () => {
    const londonUk = computeIpScope("203.0.113.9", {
      country: "英国", region: null, city: "London", cityGeonameId: 2643743, asn: 14061, asnOrg: "DigitalOcean",
    });
    const londonCa = computeIpScope("198.51.100.4", {
      country: "加拿大", region: null, city: "London", cityGeonameId: 6058560, asn: 14061, asnOrg: "DigitalOcean",
    });
    expect(londonCa.scopeKey).not.toBe(londonUk.scopeKey);
  });
});

describe("computeIpScope 无归属地时按网段前缀退回", () => {
  it("IPv4 取 /24:末位变仍是同一范围,第三段变则不是", () => {
    expect(computeIpScope("203.0.113.9", null).scopeKey).toBe("net:203.0.113");
    expect(computeIpScope("203.0.113.250", null).scopeKey).toBe("net:203.0.113");
    expect(computeIpScope("203.0.114.9", null).scopeKey).not.toBe("net:203.0.113");
  });

  it("geo 存在但 asn 为 null 时同样退回网段", () => {
    expect(computeIpScope("203.0.113.9", {
      country: "中国", region: null, city: "上海", cityGeonameId: 1796236, asn: null, asnOrg: null,
    }).scopeKey).toBe("net:203.0.113");
  });

  it("IPv6 取 /64,压缩形式要先展开:同 /64 内不同地址必须同键", () => {
    const a = computeIpScope("2001:db8::1", null);
    const b = computeIpScope("2001:db8:0:0:aaaa:bbbb:cccc:dddd", null);
    expect(a.scopeKey).toBe("net:2001:db8:0:0");
    expect(b.scopeKey).toBe(a.scopeKey);
  });

  it("IPv6 换 /64 算不同范围", () => {
    expect(computeIpScope("2001:db8:1::1", null).scopeKey).not.toBe(
      computeIpScope("2001:db8:2::1", null).scopeKey,
    );
  });

  it("IPv6 组内前导零归一化:0db8 与 db8 同键", () => {
    expect(computeIpScope("2001:0db8:0000:0000::1", null).scopeKey).toBe(
      computeIpScope("2001:db8::1", null).scopeKey,
    );
  });

  it("IPv4-mapped IPv6 按 IPv4 的 /24 处理", () => {
    expect(computeIpScope("::ffff:203.0.113.9", null).scopeKey).toBe("net:203.0.113");
  });
});

// 这一组守的是「不同来源绝不静默并成一个键」。IP 来自外部可控的 X-Real-IP /
// X-Forwarded-For,曾因自造正则不锚定而把垃圾串与真实来源并键(漏报陌生来源)。
describe("computeIpScope 对非法 IP 串只整串兜底,绝不并键", () => {  it("带垃圾前缀但结尾像 IPv4 的串,不得被当成那个 IPv4 的 /24", () => {
    const junk = computeIpScope("whatever-1.2.3.4", null);
    expect(junk.scopeKey).toBe("net:whatever-1.2.3.4");
    expect(junk.scopeKey).not.toBe(computeIpScope("1.2.3.4", null).scopeKey);
  });

  it("结尾像 IPv4 的合法 IPv6 之间不得跨 /16 并键", () => {
    // 这两个 net.isIP 都返回 6,且 /16 不同,必须是两个键。
    const a = computeIpScope("2001:db8::1.2.3.4", null);
    const b = computeIpScope("2002:db8::1.2.3.4", null);
    expect(a.scopeKey).not.toBe(b.scopeKey);
  });

  it("含冒号的垃圾串不得按 IPv6 组数并键", () => {
    const a = computeIpScope("foo:bar:baz:qux:1:2:3:4", null);
    const b = computeIpScope("foo:bar:baz:qux:9:9:9:9", null);
    expect(a.scopeKey).toBe("net:foo:bar:baz:qux:1:2:3:4");
    expect(a.scopeKey).not.toBe(b.scopeKey);
  });

  it("非法串与合法地址不得同键", () => {
    expect(computeIpScope(":1:2:3:4:5:6:7", null).scopeKey).not.toBe(
      computeIpScope("0:1:2:3:4:5:6:7", null).scopeKey,
    );
  });

  it("方括号形式与裸地址不同键(不是合法 IP,整串兜底)", () => {
    expect(computeIpScope("[2001:db8::1]", null).scopeKey).toBe("net:[2001:db8::1]");
  });

  it("认不出的字符串按整串兜底", () => {
    expect(computeIpScope("garbage", null).scopeKey).toBe("net:garbage");
    expect(computeIpScope("", null).scopeKey).toBe("net:");
  });
});

const cnGeo = (region: string | null, city: string | null, asn: number | null = 9808) => ({
  country: "中国", region, city, cityGeonameId: null, asn, asnOrg: "中国移动",
});

describe("中国档收敛键", () => {
  it("有省有市 → asn|cn:省:市", () => {
    expect(computeIpScope("112.25.1.1", cnGeo("江苏省", "南京市")).scopeKey).toBe("asn:9808|cn:江苏省:南京市");
  });

  // 香港 5802 个段没有城市;没有这一档它们会全部掉到最宽的 asn: 档
  it("有省无市 → asn|cn:省（不掉到纯 asn 档）", () => {
    expect(computeIpScope("1.32.192.1", cnGeo("香港特别行政区", null)).scopeKey).toBe("asn:9808|cn:香港特别行政区");
  });

  // 空串 city 等同无市,不能拼出 `cn:省:` 尾巴——那是与省级档不同的第二个键
  it("空串 city 按无市处理,不拼空尾巴", () => {
    expect(computeIpScope("1.32.192.1", cnGeo("香港特别行政区", "")).scopeKey).toBe("asn:9808|cn:香港特别行政区");
  });

  it("省市皆无 → 退回 asn 档，不拼空值", () => {
    expect(computeIpScope("112.25.1.1", cnGeo(null, null)).scopeKey).toBe("asn:9808");
  });

  it("无 ASN 时退回网段档", () => {
    expect(computeIpScope("112.25.1.1", cnGeo("江苏省", "南京市", null)).scopeKey).toBe("net:112.25.1");
  });

  // 前缀不同,两套键不会互相并进同一个范围
  it("中国键与国外键不碰撞", () => {
    const cn = computeIpScope("112.25.1.1", cnGeo("江苏省", "南京市")).scopeKey;
    const abroad = computeIpScope("8.8.8.8", {
      country: "美国", region: null, city: "San Jose", cityGeonameId: 5392171, asn: 9808, asnOrg: "Google",
    }).scopeKey;
    expect(cn).not.toBe(abroad);
    expect(abroad).toBe("asn:9808|geo:5392171");
  });

  it("同省不同市是两个键", () => {
    expect(computeIpScope("112.25.1.1", cnGeo("江苏省", "南京市")).scopeKey)
      .not.toBe(computeIpScope("112.25.64.1", cnGeo("江苏省", "无锡市")).scopeKey);
  });

  it("city 输出的是展示串", () => {
    expect(computeIpScope("112.25.1.1", cnGeo("江苏省", "南京市")).city).toBe("江苏省 南京市");
    expect(computeIpScope("1.32.192.1", cnGeo("香港特别行政区", null)).city).toBe("香港特别行政区");
  });
});
