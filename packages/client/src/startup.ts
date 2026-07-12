import { migrateLocalSettingsToDexie, seedDefaultCategories } from "./db/index.ts";
import { runSchemaNormalizationIfNeeded } from "./db/schemaNormalization.ts";
import { runMaterialization } from "./lib/tasks.js";

// 启动初始化链：建默认分类 -> 迁移本地设置 -> schema 归一（版本闸，每版本一次）-> occurrence 物化。
// 有意不阻塞首帧：数据页全走 useLiveQuery，初始化落库后自然补渲染；
// TodoPage 挂载时会自跑 runMaterialization，这里的物化只是提前预热。
export async function runStartupTasks(): Promise<void> {
  try {
    await seedDefaultCategories();
    await migrateLocalSettingsToDexie();
    await runSchemaNormalizationIfNeeded();
    await runMaterialization();
  } catch (error) {
    console.error("[startup] 初始化失败，不影响已渲染页面:", error);
  }
}