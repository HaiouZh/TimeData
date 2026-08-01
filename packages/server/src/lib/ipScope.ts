import { isIP } from "node:net";
import { type GeoLookup, geoDisplayCity } from "./geoip.js";

export interface IpScope {
  scopeKey: string;
  country: string | null;
  /** 展示串（中国命中为『省 市』，GeoLite2 路径为城市名）——不用于拼收敛键。 */
  city: string | null;
  asnOrg: string | null;
}

// 只认真正的 IPv4-mapped(`::ffff:203.0.113.9`)与已废弃的 IPv4-compatible(`::203.0.113.9`),
// 按 IPv4 的 /24 收敛。不能放宽成「结尾是点分四段」——`2001:db8::1.2.3.4` 是合法 IPv6、
// 只是低 32 位恰好写成点分,若当 IPv4 处理会让 2001:db8:: 与 2002:db8:: 并成同一个键。
const IPV4_MAPPED_ONLY = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i;

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
 * 无归属地时的退回前缀:IPv4 取 /24,IPv6 取 /64,认不出的原样兜底。
 *
 * 先用 node:net 的 isIP 把闸(与 geoip.ts 的 maxmind.validate 同一把)。IP 来自
 * X-Real-IP / X-Forwarded-For,是外部可控字符串,自造正则挡不干净:曾经因此把
 * `whatever-1.2.3.4` 当成 IPv4、把 `2001:db8::1.2.3.4` 与 `2002:db8::1.2.3.4`
 * (两个合法但不同 /16 的 IPv6)并成同一个键,那是漏报陌生来源。
 *
 * IPv6 必须先展开——`2001:db8::1` 直接 split(":") 取前四组会得到整个地址,
 * 导致同 /64 内不同地址被判成不同范围,噪音照旧。
 */
function networkPrefix(ip: string): string {
  const family = isIP(ip);
  if (family === 4) return ip.split(".").slice(0, 3).join(".");
  if (family === 6) {
    const mapped = IPV4_MAPPED_ONLY.exec(ip);
    if (mapped?.[1] !== undefined) return mapped[1].split(".").slice(0, 3).join(".");
    const groups = expandIpv6(ip);
    if (groups) return groups.slice(0, 4).map(normalizeGroup).join(":");
    // 走到这里的是 expandIpv6 认不出的合法 IPv6:只有「非 mapped 却内嵌点分 IPv4」
    // 这一种(如 1:2:3:4:5:6:1.2.3.4,组数按点分算不齐)。整串兜底=多报一次,不漏报。
  }
  // 不是合法 IP 就整串兜底:宁可多报一次陌生来源,也不要把不同来源静默并成一个键。
  return ip;
}

/**
 * 算某个 IP 归属的「告警范围」。同一 scopeKey 内换 IP 不算新来源。
 *
 * 两套键并存、前缀不同因而不碰撞:
 * - 中国走 `cn:<省>:<市>`,数据来自内置中国段表(ADR 0028)。它没有 geoname_id,
 *   但归一后的中文省市名跨版本稳定,且键带 cn: 前缀、只用于中国,不存在 ADR 0025
 *   否决地名做键时担心的「同名不同国」碰撞。
 * - 国外仍走 GeoLite2 的 `geo:<cityGeonameId>`(ADR 0025)。
 *
 * 缺失一律退回上一档、不拼空值:否则「未知城市」与真实城市会是两个键。
 */
export function computeIpScope(ip: string, geo: GeoLookup | null): IpScope {
  const country = geo?.country ?? null;
  const asnOrg = geo?.asnOrg ?? null;
  const asn = geo?.asn ?? null;
  const region = geo?.region ?? null;
  // 空串按「无市」处理:否则 `cn:<省>:<空>` 会拼出空尾巴,与 `cn:<省>` 是两个键
  const city = geo?.city || null;
  const cityGeonameId = geo?.cityGeonameId ?? null;

  let scopeKey: string;
  if (asn === null) {
    scopeKey = `net:${networkPrefix(ip)}`;
  } else if (region !== null) {
    // 香港等 5802 个段只有省没有市,省级档避免它们全部掉进最宽的 asn: 档
    scopeKey = city === null ? `asn:${asn}|cn:${region}` : `asn:${asn}|cn:${region}:${city}`;
  } else if (cityGeonameId === null) {
    scopeKey = `asn:${asn}`;
  } else {
    scopeKey = `asn:${asn}|geo:${cityGeonameId}`;
  }

  return { scopeKey, country, city: geo === null ? null : geoDisplayCity(geo), asnOrg };
}
