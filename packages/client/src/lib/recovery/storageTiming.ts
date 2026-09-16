/**
 * 存储探针的计时与吞错（ios-instant-open 阶段1 design §2.5，落地前身残留账 Q3「计时与吞错都在调用方」）。
 * 纯函数：不 import db，被测时注入 probe；看门狗与会话收集器共用。
 */

export interface StorageProbeResult {
  /** 往返耗时（成功或抛错都记）。 */
  ms: number;
  /** 抛错时的错误类型名；成功为 null。 */
  errorName: string | null;
}

export const STORAGE_ERROR_NAME_MAX = 60;

function nameOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/** 只取类型名（Dexie 包装错误拼上内层名），绝不取消息正文——消息里可能带用户数据。 */
export function storageErrorName(error: unknown): string {
  const outer = nameOf(error) ?? typeof error;
  const innerValue = typeof error === "object" && error !== null ? (error as { inner?: unknown }).inner : undefined;
  const inner = nameOf(innerValue);
  return (inner ? `${outer}/${inner}` : outer).slice(0, STORAGE_ERROR_NAME_MAX);
}

function defaultNow(): number {
  return performance.now();
}

export async function timeStorageProbe(
  probe: () => Promise<unknown>,
  now: () => number = defaultNow,
): Promise<StorageProbeResult> {
  const start = now();
  try {
    await probe();
    return { ms: Math.max(0, Math.round(now() - start)), errorName: null };
  } catch (error) {
    return { ms: Math.max(0, Math.round(now() - start)), errorName: storageErrorName(error) };
  }
}
