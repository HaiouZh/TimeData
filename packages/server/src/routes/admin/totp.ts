import { Hono } from "hono";
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotpCode } from "../../lib/totp.js";
import {
  clearTotpEnrollment,
  consumeRecoveryCode,
  enrollTotp,
  getTotpSecret,
  isTotpEnrolled,
} from "../../lib/totpStore.js";

interface PendingSetup {
  secret: string;
  recoveryCodes: string[];
  /** setup 发生的时刻(ms),用于 TTL 判定 */
  createdAt: number;
}

/** 待确认绑定的存活时长:超时的 pending 视为不存在,避免陈旧密钥被后来者用旧码确认。 */
const PENDING_SETUP_TTL_MS = 10 * 60 * 1000;

// 待确认的绑定密钥,仅存内存不落库;confirm 成功或重新 setup 时更替
let pendingSetup: PendingSetup | null = null;

/** TOTP 绑定管理路由工厂:now 可注入以便测试,对齐 createRequireTotp 风格。 */
export function createTotpRoute(opts: { now?: () => number } = {}): Hono {
  const now = opts.now ?? Date.now;
  const totp = new Hono();

  // 查询绑定状态
  totp.get("/", (c) => c.json({ enrolled: isTotpEnrolled() }));

  // 生成待确认密钥与恢复码(重复 setup 覆盖旧 pending)
  totp.post("/setup", (c) => {
    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes();
    pendingSetup = { secret, recoveryCodes, createdAt: now() };
    return c.json({ secret, otpauthUri: otpauthUri(secret, "TimeData"), recoveryCodes });
  });

  // 校验码后正式落库绑定
  totp.post("/confirm", async (c) => {
    if (isTotpEnrolled()) return c.json({ error: "already_enrolled" }, 409);
    // 过期 pending 直接丢弃,与从未 setup 同义
    if (pendingSetup && now() - pendingSetup.createdAt >= PENDING_SETUP_TTL_MS) pendingSetup = null;
    if (!pendingSetup) return c.json({ error: "no_pending_setup" }, 400);

    const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code : "";
    if (!verifyTotpCode(pendingSetup.secret, code, now())) {
      return c.json({ error: "totp_invalid" }, 400);
    }

    enrollTotp(pendingSetup.secret, pendingSetup.recoveryCodes);
    pendingSetup = null;
    return c.json({ enrolled: true });
  });

  // 当期码或恢复码验证通过后解除绑定
  totp.post("/disable", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
    const code = typeof body.code === "string" ? body.code : "";

    const secret = getTotpSecret();
    const totpOk = secret !== null && verifyTotpCode(secret, code, now());
    const recoveryOk = !totpOk && /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code) && consumeRecoveryCode(code);
    if (!totpOk && !recoveryOk) return c.json({ error: "totp_invalid" }, 401);

    clearTotpEnrollment();
    return c.json({ enrolled: false });
  });

  return totp;
}

export default createTotpRoute();
