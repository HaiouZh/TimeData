import { describe, expect, it } from "vitest";
import { computeIpScope } from "./ipScope.js";

describe("computeIpScope 三档收敛", () => {
  it("有 ASN 且有城市:按 asn+city 收敛,同范围换 IP 得同一个键", () => {
    const geo = { country: "中国", city: "上海", asn: 9808, asnOrg: "China Mobile" };
    const a = computeIpScope("203.0.113.9", geo);
    const b = computeIpScope("203.0.113.77", geo);
    expect(a.scopeKey).toBe("asn:9808|city:上海");
    expect(b.scopeKey).toBe(a.scopeKey);
    expect(a).toMatchObject({ country: "中国", city: "上海", asnOrg: "China Mobile" });
  });

  it("有 ASN 无城市:退回只用 asn,不拼空城市", () => {
    const scope = computeIpScope("203.0.113.9", {
      country: "美国",
      city: null,
      asn: 14061,
      asnOrg: "DigitalOcean",
    });
    expect(scope.scopeKey).toBe("asn:14061");
    expect(scope.city).toBeNull();
  });

  it("换城市算不同范围,换 ASN 也算不同范围", () => {
    const shanghai = computeIpScope("203.0.113.9", {
      country: "中国",
      city: "上海",
      asn: 9808,
      asnOrg: "China Mobile",
    });
    const nanjing = computeIpScope("203.0.113.9", {
      country: "中国",
      city: "南京",
      asn: 9808,
      asnOrg: "China Mobile",
    });
    const unicom = computeIpScope("203.0.113.9", {
      country: "中国",
      city: "上海",
      asn: 4837,
      asnOrg: "China Unicom",
    });
    expect(nanjing.scopeKey).not.toBe(shanghai.scopeKey);
    expect(unicom.scopeKey).not.toBe(shanghai.scopeKey);
  });
});

describe("computeIpScope 无归属地时按网段前缀退回", () => {
  it("IPv4 取 /24:末位变仍是同一范围,第三段变则不是", () => {
    expect(computeIpScope("203.0.113.9", null).scopeKey).toBe("net:203.0.113");
    expect(computeIpScope("203.0.113.250", null).scopeKey).toBe("net:203.0.113");
    expect(computeIpScope("203.0.114.9", null).scopeKey).not.toBe("net:203.0.113");
  });

  it("geo 存在但 asn 为 null 时同样退回网段", () => {
    expect(
      computeIpScope("203.0.113.9", {
        country: "中国",
        city: "上海",
        asn: null,
        asnOrg: null,
      }).scopeKey,
    ).toBe("net:203.0.113");
  });

  it("IPv6 取 /64,压缩形式要先展开:同 /64 内不同地址必须同键", () => {
    const a = computeIpScope("2001:db8::1", null);
    const b = computeIpScope("2001:db8:0:0:aaaa:bbbb:cccc:dddd", null);
    expect(a.scopeKey).toBe("net:2001:db8:0:0");
    expect(b.scopeKey).toBe(a.scopeKey);
  });

  it("IPv6 换 /64 算不同范围", () => {
    expect(computeIpScope("2001:db8:1::1", null).scopeKey).not.toBe(computeIpScope("2001:db8:2::1", null).scopeKey);
  });

  it("IPv6 组内前导零归一化:0db8 与 db8 同键", () => {
    expect(computeIpScope("2001:0db8:0000:0000::1", null).scopeKey).toBe(computeIpScope("2001:db8::1", null).scopeKey);
  });

  it("IPv4-mapped IPv6 按 IPv4 的 /24 处理", () => {
    expect(computeIpScope("::ffff:203.0.113.9", null).scopeKey).toBe("net:203.0.113");
  });

  it("无法解析的字符串按整串兜底(宁多报不漏报)", () => {
    expect(computeIpScope("garbage", null).scopeKey).toBe("net:garbage");
  });
});
