import { db } from "../../db/index.js";

/**
 * 一次最小的 IndexedDB 往返，只看它多久回来、不看内容。
 *
 * 与 transition 探针同时发出：判定时它还没回来，就说明存储层被冻着（回前台后
 * WebKit 的 IndexedDB 偶发长时间不响应），页面「什么都不动」可能根本不是调度器的事。
 * 挑 categories：表小、恒存在，limit(1) 不扫全表。
 */
export function probeStorage(): Promise<unknown> {
  return db.categories.limit(1).toArray();
}
