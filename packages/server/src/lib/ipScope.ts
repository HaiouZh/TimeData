import type { GeoLookup } from "./geoip.js";

export interface IpScope {
  scopeKey: string;
  country: string | null;
  city: string | null;
  asnOrg: string | null;
}

// 纯 IPv4,以及 IPv4-mapped/compat 形式(`::ffff:203.0.113.9`)。两者都按 IPv4 的 /24 收敛。
// 锚定到整串:IP 来自 X-Real-IP / X-Forwarded-For,是外部可控字符串,
// 不锚定的话 `whatever-1.2.3.4` 这类垃圾会被当成 IPv4,把互不相干的来源并成同一个键。
const IPV4_ONLY = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV4_MAPPED = /^[0-9a-fA-F:]*:(\d{1,3}(?:\.\d{1,3}){3})$/;

/** 把压缩过的 IPv6 展开成 8 组;无法解析返回 null。 */
function expandIpv6(ip: string): string[] | null {
  const zoneless = ip.split("%")[0] ?? ip;
  const halves = zoneless.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array<string>(fill).fill("0"), ...tail];
}

/** 组内去前导零并小写,让 `0db8` 与 `db8` 归一。 */
function normalizeGroup(group: string): string {
  const trimmed = group.toLowerCase().replace(/^0+(?=.)/, "");
  return trimmed === "" ? "0" : trimmed;
}

/**
 * 无归属地时的退回前缀:IPv4 取 /24,IPv6 取 /64。
 * IPv6 必须先展开——`2001:db8::1` 直接 split(":") 取前四组会得到整个地址,
 * 导致同 /64 内不同地址被判成不同范围,噪音照旧。
 */
function networkPrefix(ip: string): string {
  const ipv4 = IPV4_ONLY.test(ip) ? ip : (IPV4_MAPPED.exec(ip)?.[1] ?? null);
  if (ipv4 !== null) return ipv4.split(".").slice(0, 3).join(".");
  if (ip.includes(":")) {
    const groups = expandIpv6(ip);
    if (groups) return groups.slice(0, 4).map(normalizeGroup).join(":");
  }
  // 认不出来就按整串兜底:宁可多报一次陌生来源,也不要把不同来源静默并成一个键。
  return ip;
}

/** 算某个 IP 归属的「告警范围」。同一 scopeKey 内换 IP 不算新来源。 */
export function computeIpScope(ip: string, geo: GeoLookup | null): IpScope {
  const country = geo?.country ?? null;
  const city = geo?.city ?? null;
  const asnOrg = geo?.asnOrg ?? null;
  const asn = geo?.asn ?? null;

  // 城市缺失只退回 asn,不拼空串:否则「未知城市」与真实城市会是两个键。
  const scopeKey = asn === null ? `net:${networkPrefix(ip)}` : city ? `asn:${asn}|city:${city}` : `asn:${asn}`;

  return { scopeKey, country, city, asnOrg };
}
