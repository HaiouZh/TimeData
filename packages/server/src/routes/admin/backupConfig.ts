import type { AdminBackupConfigResponse } from "@timedata/shared";
import { BackupConfigSchema } from "@timedata/shared";
import { Hono } from "hono";
import { errorJson, ErrorCode } from "../../lib/errors.js";
import { readBackupMeta, writeBackupMeta } from "../../sync/backup.js";

const backupConfig = new Hono();

backupConfig.get("/", (c) => {
  const meta = readBackupMeta();
  const response: AdminBackupConfigResponse = {
    config: { dailyBackup: meta.dailyBackup, retentionDays: meta.retentionDays },
  };
  return c.json(response);
});

backupConfig.put("/", async (c) => {
  const parsed = BackupConfigSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, undefined, { issues: parsed.error.issues });
    return c.json(body, status);
  }

  const meta = writeBackupMeta({
    dailyBackup: parsed.data.dailyBackup,
    retentionDays: parsed.data.retentionDays,
  });
  const response: AdminBackupConfigResponse = {
    config: { dailyBackup: meta.dailyBackup, retentionDays: meta.retentionDays },
  };
  return c.json(response);
});

export default backupConfig;
