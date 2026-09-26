import { Hono } from "hono";
import { buildOffsiteBackupStatus, readOffsiteBackupRunsTail } from "../../lib/offsiteBackup.js";

const offsiteBackup = new Hono();

offsiteBackup.get("/", (c) => c.json(buildOffsiteBackupStatus(readOffsiteBackupRunsTail(), new Date())));

export default offsiteBackup;
