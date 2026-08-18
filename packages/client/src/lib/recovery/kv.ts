import { safeGetItem, safeRemoveItem, safeSetItem } from "../safeStorage.js";

/** 恢复相关模块共用的最小存储面。默认参数给真实实现、测试传假的——范式取自 sync/phaseTimings.ts 的 TimingsKV。 */
export interface RecoveryKV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const defaultRecoveryKV: RecoveryKV = {
  get: safeGetItem,
  set: (key, value) => {
    safeSetItem(key, value);
  },
  remove: safeRemoveItem,
};
