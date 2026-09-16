import { STORAGE_KEYS } from "../storageKeys.js";
import { type RecoveryKV, defaultRecoveryKV } from "./kv.js";

/**
 * 转后台时间戳（ios-instant-open 阶段1 design §3.4）：open_session 的 `hiddenMs`，以及「这次恢复事件前真的转过后台吗」。
 * 后者挡住 App 没离开前台时零星冒出来的 focus 事件被当成一次新的打开。
 */

let lastHiddenAt: number | null = null;
let hiddenSinceConsumed = false;

export function markHidden(at: number = Date.now(), kv: RecoveryKV = defaultRecoveryKV): void {
  lastHiddenAt = at;
  hiddenSinceConsumed = true;
  kv.set(STORAGE_KEYS.lastHiddenAt, String(at));
}

/** 自上次消费以来是否转过后台；读后清。 */
export function consumeHiddenFlag(): boolean {
  const seen = hiddenSinceConsumed;
  hiddenSinceConsumed = false;
  return seen;
}

/** 回前台：距本页面最近一次转后台。没见过为 null；时钟回拨夹到 0。 */
export function hiddenMsSinceInMemory(now: number = Date.now()): number | null {
  return lastHiddenAt === null ? null : Math.max(0, now - lastHiddenAt);
}

/** 冷启动：距上一个页面最后一次转后台（读持久化值）。缺失、非法或来自未来为 null。 */
export function hiddenMsSincePersisted(now: number = Date.now(), kv: RecoveryKV = defaultRecoveryKV): number | null {
  const raw = kv.get(STORAGE_KEYS.lastHiddenAt);
  if (raw === null) return null;
  const at = Number(raw);
  if (!Number.isFinite(at)) return null;
  const elapsed = now - at;
  return elapsed < 0 ? null : elapsed;
}

/** 仅供测试。 */
export function resetLastHidden(): void {
  lastHiddenAt = null;
  hiddenSinceConsumed = false;
}
