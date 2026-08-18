import { STORAGE_KEYS } from "../storageKeys.js";
import { type RecoveryKV, defaultRecoveryKV } from "./kv.js";

/** 会主动重载页面的两条路径。第三种可能——iOS 回收渲染进程——不经过 JS，故没有对应值。 */
export type ReloadActor = "watchdog" | "update";

export type ReloadCause = "cold" | ReloadActor | "external";

export interface ReloadTombstone {
  at: number;
  by: ReloadActor;
}

/** 墓碑新鲜度窗口：主动重载到新页面读到它通常一两秒，30s 足够覆盖慢机型的冷启动。 */
export const TOMBSTONE_FRESHNESS_MS = 30_000;

export function markReload(by: ReloadActor, now: number, kv: RecoveryKV = defaultRecoveryKV): void {
  kv.set(STORAGE_KEYS.reloadTombstone, JSON.stringify({ at: now, by } satisfies ReloadTombstone));
}

export function readTombstone(kv: RecoveryKV = defaultRecoveryKV): ReloadTombstone | null {
  const raw = kv.get(STORAGE_KEYS.reloadTombstone);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { at?: unknown; by?: unknown };
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return null;
    if (parsed.by !== "watchdog" && parsed.by !== "update") return null;
    return { at: parsed.at, by: parsed.by };
  } catch {
    return null;
  }
}

export function consumeTombstone(kv: RecoveryKV = defaultRecoveryKV): void {
  kv.remove(STORAGE_KEYS.reloadTombstone);
}

/**
 * 判定本次加载因何而来——这是「iOS 回收了渲染进程」唯一能在 JS 侧拿到的证据。
 *
 * 三条重载路径里，前两条（看门狗自救、版本更新）都由 JS 自己发起，重载前会留墓碑；
 * 第三条是 Capacitor 在 WebView 层 reload，JS 全程不知情，因此「是 reload 却没有墓碑」
 * 就等价于「渲染进程被回收」。窗口外或来自未来的墓碑一律不认，宁可误判成 external
 * 也不能把一次真实回收算到主动路径头上——那会让频率统计偏低、掩盖问题。
 */
export function attributeReload(
  navigationType: string,
  tombstone: ReloadTombstone | null,
  now: number,
  freshnessMs = TOMBSTONE_FRESHNESS_MS,
): ReloadCause {
  if (navigationType !== "reload") return "cold";
  if (!tombstone) return "external";
  const age = now - tombstone.at;
  if (age < 0 || age > freshnessMs) return "external";
  return tombstone.by;
}
