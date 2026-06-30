import fs from "node:fs";
import path from "node:path";
import type { AdminBackupsResponse, AdminRunDailyResponse } from "@timedata/shared";
import { Hono } from "hono";
import { errorJson, ErrorCode } from "../../lib/errors.js";
import { getBackupDir, readBackupManifest, writeBackupManifest } from "../../sync/backup.js";
import { runDailyBackupIfDue } from "../../sync/dailyBackup.js";
import { listServerBackups } from "./_helpers.js";

const backups = new Hono();

backups.get("/", (c) => {
  const response: AdminBackupsResponse = {
    backups: listServerBackups(),
  };
  return c.json(response);
});

backups.post("/run-daily", async (c) => {
  const response: AdminRunDailyResponse = await runDailyBackupIfDue();
  return c.json(response);
});

backups.delete("/:id", (c) => {
  const id = c.req.param("id");
  const manifest = readBackupManifest();
  const entry = manifest.backups[id];
  const fileName = entry?.fileName ?? id;
  if (fileName !== path.basename(fileName) || !fileName.endsWith(".db")) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, "Invalid backup id.");
    return c.json(body, status);
  }

  const backupDir = path.resolve(getBackupDir());
  const filePath = path.resolve(backupDir, fileName);
  if (!filePath.startsWith(`${backupDir}${path.sep}`)) {
    const { body, status } = errorJson(ErrorCode.INVALID_REQUEST, 400, "Invalid backup id.");
    return c.json(body, status);
  }

  if (!fs.existsSync(filePath)) {
    const { body, status } = errorJson(ErrorCode.NOT_FOUND, 404, "Backup not found.");
    return c.json(body, status);
  }

  fs.rmSync(filePath, { force: true });
  if (entry) {
    delete manifest.backups[id];
    writeBackupManifest(manifest);
  }
  return c.json({ deleted: id });
});

export default backups;
