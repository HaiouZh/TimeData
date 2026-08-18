import { STORAGE_KEYS } from "../storageKeys.js";
import { type RecoveryKV, defaultRecoveryKV } from "./kv.js";

/** 恢复尝试的上限。够不到就放弃——硬滚会在内容高度不足时造成跳动，比丢位置更难受。 */
export const SCROLL_RESTORE_TIMEOUT_MS = 2000;

/** 最多记多少条路径。冷启动只用得到当前一条，留几条覆盖来回切页即可。 */
export const SCROLL_POSITIONS_MAX = 8;

type ScrollMap = Record<string, number>;

function parse(raw: string | null): ScrollMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: ScrollMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      // 逐元素校验：坏元素被丢弃而非传染整份记录，同 phaseTimings 的做法。
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function readScrollTop(pathname: string, kv: RecoveryKV = defaultRecoveryKV): number | null {
  return parse(kv.get(STORAGE_KEYS.scrollPositions))[pathname] ?? null;
}

export function writeScrollTop(pathname: string, top: number, kv: RecoveryKV = defaultRecoveryKV): void {
  if (!Number.isFinite(top) || top < 0) return;
  const map = parse(kv.get(STORAGE_KEYS.scrollPositions));
  // 先删再写：字符串键按插入序枚举，这样最近写的恒在队尾，裁剪才裁得掉真正最旧的那条。
  delete map[pathname];
  map[pathname] = Math.round(top);
  const entries = Object.entries(map);
  const kept = entries.length > SCROLL_POSITIONS_MAX ? entries.slice(entries.length - SCROLL_POSITIONS_MAX) : entries;
  kv.set(STORAGE_KEYS.scrollPositions, JSON.stringify(Object.fromEntries(kept)));
}

/** 内容够高才滚得到目标位置；不够说明数据还没到齐，再等一帧。 */
export function canRestoreScroll(target: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight >= target + clientHeight;
}

export function isRestoreExpired(startedAt: number, now: number, timeoutMs = SCROLL_RESTORE_TIMEOUT_MS): boolean {
  return now - startedAt >= timeoutMs;
}
