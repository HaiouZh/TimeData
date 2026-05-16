import { Hono } from "hono";
import { getUpdateStatus, triggerUpdate, UpdateAlreadyRunningError } from "../lib/update.js";

const update = new Hono();

function hostComposeDir(): string {
  return process.env.HOST_COMPOSE_DIR || "";
}

update.post("/", async (c) => {
  const updaterImage = process.env.UPDATER_IMAGE || "docker:24-cli";
  try {
    const status = triggerUpdate({ hostComposeDir: hostComposeDir(), image: updaterImage });
    return c.json({ status: "updating", updateId: status.updateId }, 202);
  } catch (err) {
    if (err instanceof UpdateAlreadyRunningError) {
      return c.json({ error: err.message, updateId: err.updateId }, 409);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

update.get("/status", (c) => {
  try {
    return c.json(getUpdateStatus(hostComposeDir()));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default update;
