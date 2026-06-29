import { Hono } from "hono";
import { errorJson, ErrorCode } from "../lib/errors.js";
import { getUpdateStatus, triggerUpdate, UpdateAlreadyRunningError } from "../lib/update.js";

const update = new Hono();

function updateStateDir(): string {
  return process.env.UPDATE_STATE_DIR || "/app/data";
}

function watchtowerUrl(): string {
  return process.env.WATCHTOWER_URL || "";
}

function watchtowerToken(): string {
  return process.env.WATCHTOWER_TOKEN || "";
}

update.post("/", async (c) => {
  try {
    const url = watchtowerUrl();
    if (!url) {
      const { body, status } = errorJson(
        ErrorCode.SELF_UPDATE_DISABLED,
        503,
        "Self-update is disabled because WATCHTOWER_URL is not configured",
      );
      return c.json(body, status);
    }
    const token = watchtowerToken();
    if (!token) {
      const { body, status } = errorJson(
        ErrorCode.SELF_UPDATE_DISABLED,
        503,
        "Self-update is disabled because WATCHTOWER_TOKEN is not configured",
      );
      return c.json(body, status);
    }

    const status = triggerUpdate({
      stateDir: updateStateDir(),
      watchtowerUrl: url,
      watchtowerToken: token,
      currentSha: process.env.GIT_SHA,
    });
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
    return c.json(getUpdateStatus(updateStateDir()));
  } catch (err) {
    console.error("[update/status] failed:", (err as Error).message);
    const { body, status } = errorJson(ErrorCode.INTERNAL_ERROR, 500);
    return c.json(body, status);
  }
});

export default update;
