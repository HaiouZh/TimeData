import type { AdminBackupsResponse } from "@timedata/shared";
import { Hono } from "hono";
import { listServerBackups } from "./_helpers.js";

const backups = new Hono();

backups.get("/", (c) => {
  const response: AdminBackupsResponse = {
    backups: listServerBackups(),
  };
  return c.json(response);
});

export default backups;
