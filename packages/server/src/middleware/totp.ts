import type { Context, MiddlewareHandler } from "hono";
import { verifyTotpCode } from "../lib/totp.js";
import { consumeRecoveryCode, getTotpSecret, isTotpEnrolled } from "../lib/totpStore.js";

export type TotpVerdict = "ok" | "totp_required" | "totp_invalid";

/**
 * 函数式 TOTP 校验:未绑定返回 "ok"(渐进启用);已绑定则要求 X-TOTP-Code 头,
 * 6 位数字走 TOTP 校验,xxxx-xxxx 格式走恢复码一次性消费。
 * 供路由级中间件与「读完 body 才知道该不该拦」的处理器(全量 pull / 批量删除 push)共用,
 * 避免两份判定逻辑分叉。
 */
export function verifyTotpForRequest(c: Context, now: number = Date.now()): TotpVerdict {
  if (!isTotpEnrolled()) return "ok";
  const code = c.req.header("X-TOTP-Code");
  if (!code) return "totp_required";

  const secret = getTotpSecret();
  const totpOk = secret !== null && verifyTotpCode(secret, code, now);
  const recoveryOk = !totpOk && /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code) && consumeRecoveryCode(code);
  return totpOk || recoveryOk ? "ok" : "totp_invalid";
}

/**
 * 危险操作 TOTP 闸(路由级中间件形态)。
 * error 字符串 totp_required / totp_invalid 被客户端依赖,不可改。
 */
export function createRequireTotp(opts: { now?: () => number } = {}): MiddlewareHandler {
  const now = opts.now ?? Date.now;
  return async (c, next) => {
    const verdict = verifyTotpForRequest(c, now());
    if (verdict !== "ok") return c.json({ error: verdict }, 401);
    await next();
  };
}

export const requireTotp = createRequireTotp();
