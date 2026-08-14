import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../../db/index.ts";
import { recordSyncLog } from "../../sync/engine.ts";

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.settings.get(key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction("rw", db.settings, db.syncLog, async () => {
    if (value === null) {
      const existing = await db.settings.get(key);
      await db.settings.delete(key);
      if (existing) await recordSyncLog("settings", key, "delete");
      return;
    }

    const existing = await db.settings.get(key);
    await db.settings.put({ key, value, updatedAt: now });
    await recordSyncLog("settings", key, existing ? "update" : "create");
  });
}

/**
 * 与 {@link useSetting} 同源，但**保留 liveQuery 的三态**：`undefined` = 首帧、查询还没回流；
 * `null` = 已读到、该键没值。
 *
 * `useSetting` 把这两种一并抹成 `null`，对多数消费方无所谓；但对「首帧长什么样」有要求的地方
 * 两者的正确回退是相反的——未回流该沿用上次已知值，真没值才该落到默认值（见
 * `navVisibleTabsSetting` 的 `useTabOrder`）。
 */
export function useSettingLoad(key: string): string | null | undefined {
  return useLiveQuery(async () => (await db.settings.get(key))?.value ?? null, [key]);
}

export function useSetting(key: string): string | null {
  return useSettingLoad(key) ?? null;
}
