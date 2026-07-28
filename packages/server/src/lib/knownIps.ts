import { getDb } from "../db/connection.js";

// 只对真正带凭证的 tier 做陌生 IP 检测;public/missing/invalid/unknown 无意义,恒 false 且不落库。
const TRACKED_TIERS = new Set(["master", "agent", "dev_bypass"]);

export interface UnacknowledgedNewIp {
  tokenTier: string;
  ip: string;
  firstSeen: string;
  lastSeen: string;
}

type KnownIpDbRow = {
  token_tier: string;
  ip: string;
  first_seen: string;
  last_seen: string;
};

/**
 * 检测并记录来源 IP:首见插入并返回 true(新 IP),再见只更新 last_seen 返回 false。
 * ip 为 null 或 tier 不在检测范围内时恒 false 且不写库。
 */
export function checkAndRecordIp(tokenTier: string, ip: string | null, nowIso: string): boolean {
  if (ip === null || !TRACKED_TIERS.has(tokenTier)) return false;
  const db = getDb();
  const updated = db
    .prepare("UPDATE known_ips SET last_seen = ? WHERE token_tier = ? AND ip = ?")
    .run(nowIso, tokenTier, ip);
  if (updated.changes > 0) return false;
  db.prepare(
    "INSERT INTO known_ips (token_tier, ip, first_seen, last_seen, acknowledged) VALUES (?, ?, ?, ?, 0)",
  ).run(tokenTier, ip, nowIso, nowIso);
  return true;
}

/** 列出所有未确认的新 IP,新出现的在前。 */
export function listUnacknowledgedNewIps(): UnacknowledgedNewIp[] {
  return (getDb()
    .prepare(`
      SELECT token_tier, ip, first_seen, last_seen
      FROM known_ips
      WHERE acknowledged = 0
      ORDER BY first_seen DESC, token_tier ASC, ip ASC
    `)
    .all() as KnownIpDbRow[]).map((row) => ({
    tokenTier: row.token_tier,
    ip: row.ip,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  }));
}

/** 确认某个新 IP,之后不再出现在未确认列表(幂等)。 */
export function acknowledgeIp(tokenTier: string, ip: string): void {
  getDb()
    .prepare("UPDATE known_ips SET acknowledged = 1 WHERE token_tier = ? AND ip = ?")
    .run(tokenTier, ip);
}
