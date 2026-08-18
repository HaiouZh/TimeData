import { migrateGoalPrerequisitesToRelations, migrateLocalSettingsToDexie, seedDefaultCategories } from "./db/index.ts";
import { runSchemaNormalizationIfNeeded } from "./db/schemaNormalization.ts";
import { safeGetItem, safeSetItem } from "./lib/safeStorage.js";
import { STORAGE_KEYS } from "./lib/storageKeys.js";
import { runMaterialization } from "./lib/tasks.js";
import { GOAL_PREREQ_MIGRATION_VERSION, shouldRunGoalPrereqMigration } from "./startupGate.ts";

/** 前置边搬家套上版本闸，跑完才记——老数据第一次进新版本时照跑不误，不会漏迁移。 */
async function migrateGoalPrerequisitesIfNeeded(): Promise<void> {
  const saved = safeGetItem(STORAGE_KEYS.goalPrereqMigrationVersion);
  if (!shouldRunGoalPrereqMigration(saved, GOAL_PREREQ_MIGRATION_VERSION)) return;
  await migrateGoalPrerequisitesToRelations();
  safeSetItem(STORAGE_KEYS.goalPrereqMigrationVersion, String(GOAL_PREREQ_MIGRATION_VERSION));
}

// 启动初始化链：建默认分类 -> 迁移本地设置 -> 前置边搬家（带版本闸）-> schema 归一（版本闸，每版本一次）。
// 由 main.tsx 推到首帧之后再跑：这条链会跟首屏渲染抢主线程与 IndexedDB，
// 而数据页全走 useLiveQuery，初始化落库后自然补渲染。
export async function runStartupTasks(): Promise<void> {
  try {
    await seedDefaultCategories();
    await migrateLocalSettingsToDexie();
    await migrateGoalPrerequisitesIfNeeded();
    await runSchemaNormalizationIfNeeded();
  } catch (error) {
    console.error("[startup] 初始化失败，不影响已渲染页面:", error);
  }
}

// occurrence 物化从启动链里移出来单跑：它是 `tasks.filter()` 全表扫（Dexie 的 filter 不走索引）
// 加逐规则事务，是冷启动里最贵的一段，而 TodoPage 挂载时本就会自跑。这里只当空闲预热。
export async function warmMaterialization(): Promise<void> {
  try {
    await runMaterialization();
  } catch (error) {
    console.error("[startup] 物化预热失败，TodoPage 挂载时会重跑:", error);
  }
}
