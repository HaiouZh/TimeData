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

export function useSetting(key: string): string | null {
  return useLiveQuery(async () => (await db.settings.get(key))?.value ?? null, [key]) ?? null;
}
