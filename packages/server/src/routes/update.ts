import { Hono } from "hono";
import { errorJson, ErrorCode } from "../lib/errors.js";
import { getUpdateStatus, triggerUpdate, UpdateAlreadyRunningError } from "../lib/update.js";

const update = new Hono();

function hostComposeDir(): string {
  return process.env.HOST_COMPOSE_DIR || "";
}

update.post("/", async (c) => {
  const updaterImage = process.env.UPDATER_IMAGE || "docker:24-cli";
  try {
    const status = triggerUpdate({ hostComposeDir: hostComposeDir(), image: updaterImage });
    return c.json({ ok: true, status: "updating", updateId: status.updateId }, 202);
  } catch (err) {
    if (err instanceof UpdateAlreadyRunningError) {
      const { body, status } = errorJson(ErrorCode.CONFLICT, 409, err.message, { updateId: err.updateId });
      return c.json(body, status);
    }
    console.error("[update] trigger failed:", (err as Error).message);
    const { body, status } = errorJson(ErrorCode.INTERNAL_ERROR, 500);
    return c.json(body, status);
  }
});

update.get("/status", (c) => {
  try {
    return c.json(getUpdateStatus(hostComposeDir()));
  } catch (err) {
    console.error("[update/status] failed:", (err as Error).message);
    const { body, status } = errorJson(ErrorCode.INTERNAL_ERROR, 500);
    return c.json(body, status);
  }
});

export default update;
