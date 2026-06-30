import fs from "node:fs";
import path from "node:path";
import type { AdminBackupsResponse, AdminRunDailyResponse } from "@timedata/shared";
import { Hono } from "hono";
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
  const fileName = entry?.fileName ?? `${id}.db`;
  fs.rmSync(path.join(getBackupDir(), fileName), { force: true });
  if (entry) {
    delete manifest.backups[id];
    writeBackupManifest(manifest);
  }
  return c.json({ deleted: id });
});

export default backups;
