function getStorage(): Storage | null {
  try {
    return "localStorage" in globalThis ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function safeGetItem(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch (err) {
    console.warn(`[safeStorage] getItem(${key}) failed:`, err);
    return null;
  }
}

export function safeSetItem(key: string, value: string): boolean {
  try {
    getStorage()?.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[safeStorage] setItem(${key}) failed:`, err);
    return false;
  }
}

export function safeRemoveItem(key: string): void {
  try {
    getStorage()?.removeItem(key);
  } catch (err) {
    console.warn(`[safeStorage] removeItem(${key}) failed:`, err);
  }
}
