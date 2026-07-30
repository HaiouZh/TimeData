import { getDb } from "../db/connection.js";
import { type GeoLookup, lookupGeo } from "./geoip.js";
import { computeIpScope } from "./ipScope.js";

// 只对真正带凭证的 tier 做陌生来源检测;public/missing/invalid/unknown 无意义,恒 false 且不落库。
const TRACKED_TIERS = new Set(["master", "agent", "dev_bypass"]);

export interface UnacknowledgedNewIpScope {
  tokenTier: string;
  scopeKey: string;
  country: string | null;
  city: string | null;
  asnOrg: string | null;
  lastIp: string | null;
  firstSeen: string;
  lastSeen: string;
}

type KnownIpScopeDbRow = {
  token_tier: string;
  scope_key: string;
  country: string | null;
  city: string | null;
  asn_org: string | null;
  last_ip: string | null;
  first_seen: string;
  last_seen: string;
};

/**
 * 检测并记录来源范围:首见插入并返回 true(新范围),再见只更新 last_seen / last_ip 返回 false。
 * 收敛到「运营商+城市」而非精确 IP——动态 IP 与 VPN 出口下按精确 IP 永远确认不完(ADR 0025)。
 * ip 为 null 或 tier 不在检测范围内时恒 false 且不写库。
 * geoLookup 可注入,便于单测不依赖真实 mmdb。
 */
export function checkAndRecordIp(
  tokenTier: string,
  ip: string | null,
  nowIso: string,
  geoLookup: (ip: string) => GeoLookup | null = lookupGeo,
): boolean {
  if (ip === null || !TRACKED_TIERS.has(tokenTier)) return false;
  const scope = computeIpScope(ip, geoLookup(ip));
  const db = getDb();
  const updated = db
    .prepare("UPDATE known_ip_scopes SET last_seen = ?, last_ip = ? WHERE token_tier = ? AND scope_key = ?")
    .run(nowIso, ip, tokenTier, scope.scopeKey);
  if (updated.changes > 0) return false;
  db.prepare(`
    INSERT INTO known_ip_scopes
      (token_tier, scope_key, country, city, asn_org, last_ip, first_seen, last_seen, acknowledged)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(tokenTier, scope.scopeKey, scope.country, scope.city, scope.asnOrg, ip, nowIso, nowIso);
  return true;
}

/** 列出所有未确认的新来源范围,新出现的在前。 */
export function listUnacknowledgedNewIpScopes(): UnacknowledgedNewIpScope[] {
  return (getDb()
    .prepare(`
      SELECT token_tier, scope_key, country, city, asn_org, last_ip, first_seen, last_seen
      FROM known_ip_scopes
      WHERE acknowledged = 0
      ORDER BY first_seen DESC, token_tier ASC, scope_key ASC
    `)
    .all() as KnownIpScopeDbRow[]).map((row) => ({
    tokenTier: row.token_tier,
    scopeKey: row.scope_key,
    country: row.country,
    city: row.city,
    asnOrg: row.asn_org,
    lastIp: row.last_ip,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  }));
}

/** 确认某个来源范围,之后不再出现在未确认列表(幂等)。 */
export function acknowledgeIpScope(tokenTier: string, scopeKey: string): void {
  getDb()
    .prepare("UPDATE known_ip_scopes SET acknowledged = 1 WHERE token_tier = ? AND scope_key = ?")
    .run(tokenTier, scopeKey);
}
