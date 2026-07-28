import { createHash } from "node:crypto";
import { getDb } from "../db/connection.js";

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function isTotpEnrolled(): boolean {
  return getDb().prepare("SELECT 1 FROM totp_config WHERE id = 1").get() !== undefined;
}

export function getTotpSecret(): string | null {
  const row = getDb().prepare("SELECT secret FROM totp_config WHERE id = 1").get() as { secret: string } | undefined;
  return row?.secret ?? null;
}

/** 绑定 TOTP:事务写入 secret 与恢复码 sha256 哈希;已绑定时抛错(须先 clear)。 */
export function enrollTotp(secretBase32: string, recoveryCodes: string[]): void {
  const db = getDb();
  const insertConfig = db.prepare("INSERT INTO totp_config (id, secret, created_at) VALUES (1, ?, ?)");
  const insertCode = db.prepare("INSERT INTO totp_recovery_codes (code_hash) VALUES (?)");
  db.transaction(() => {
    if (isTotpEnrolled()) throw new Error("TOTP 已绑定,须先解除绑定再重新绑定");
    insertConfig.run(secretBase32, new Date().toISOString());
    for (const code of recoveryCodes) insertCode.run(hashRecoveryCode(code));
  })();
}

/** 消费恢复码:命中未用哈希则标记 used_at 返回 true;一次性,复用/未知码返回 false。 */
export function consumeRecoveryCode(code: string): boolean {
  const result = getDb()
    .prepare("UPDATE totp_recovery_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL")
    .run(new Date().toISOString(), hashRecoveryCode(code));
  return result.changes === 1;
}

/** 解除绑定:删 secret 与全部恢复码——disable 与服务器逃生舱共用。 */
export function clearTotpEnrollment(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM totp_config").run();
    db.prepare("DELETE FROM totp_recovery_codes").run();
  })();
}
