// 必须在 db/index 之前求值：Dexie 在 `new Dexie()` 构造时即捕获 globalThis.indexedDB，
// 晚注册会捕获到 undefined → MissingAPIError。本助手把 fake-idb 注册 + db 单例 + reset 收在一处，
// 测试统一 `import { db, resetDb } from ".../test/dbReset.js"`（单条 import 保证求值顺序，免去裸 import "fake-indexeddb/auto" 的顺序坑）。
import "fake-indexeddb/auto";
import { db } from "../db/index.js";

export { db };

// 把共享 db 复位成"已开、全表空"——绝不 db.delete()（避免每用例重建 13 版 schema upgrade 吃掉 no-isolate 提速）。
// db 测试文件用它作 beforeEach/afterEach，即可在 isolate:false 下天然隔离数据态。幂等。
export async function resetDb(): Promise<void> {
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
}
