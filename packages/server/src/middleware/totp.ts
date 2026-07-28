import type { MiddlewareHandler } from "hono";
import { verifyTotpCode } from "../lib/totp.js";
import { consumeRecoveryCode, getTotpSecret, isTotpEnrolled } from "../lib/totpStore.js";

/**
 * 危险操作 TOTP 闸:未绑定放行(渐进启用);已绑定则要求 X-TOTP-Code 头,
 * 6 位数字走 TOTP 校验,xxxx-xxxx 格式走恢复码一次性消费。
 * error 字符串 totp_required / totp_invalid 被客户端依赖,不可改。
 */
export function createRequireTotp(opts: { now?: () => number } = {}): MiddlewareHandler {
  const now = opts.now ?? Date.now;
  return async (c, next) => {
    if (!isTotpEnrolled()) {
      await next();
      return;
    }
    const code = c.req.header("X-TOTP-Code");
    if (!code) return c.json({ error: "totp_required" }, 401);

    const secret = getTotpSecret();
    const totpOk = secret !== null && verifyTotpCode(secret, code, now());
    const recoveryOk = !totpOk && /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code) && consumeRecoveryCode(code);
    if (!totpOk && !recoveryOk) return c.json({ error: "totp_invalid" }, 401);
    await next();
  };
}

export const requireTotp = createRequireTotp();
