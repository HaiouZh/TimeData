import { Hono } from "hono";
import { resetDatabaseToDefaults } from "../db/reset.js";
import { createTokenStore } from "../lib/confirm-token.js";
import { createServerBackup } from "../sync/backup.js";
import { notifySyncChange } from "../sync/notifier.js";
import { getLatestSeq } from "../sync/seq.js";

const RESET_PHRASE = "RESET_DATA" as const;
const resetTokens = createTokenStore<{ requestedAt: string }>(5 * 60 * 1000);

const data = new Hono();

data.post("/reset/prepare", (c) => {
  const { token, expiresAt } = resetTokens.create({ requestedAt: new Date().toISOString() });
  return c.json({
    confirmToken: token,
    confirmationPhrase: RESET_PHRASE,
    expiresAt: expiresAt.toISOString(),
  });
});

interface ResetRequestBody {
  confirmToken?: string;
  confirmationPhrase?: string;
}

data.post("/reset", async (c) => {
  const body = await c.req.json<ResetRequestBody>().catch((): ResetRequestBody => ({}));
  if (body.confirmationPhrase !== RESET_PHRASE) {
    return c.json({ error: "Invalid confirmation phrase" }, 400);
  }

  const consumed = resetTokens.consume(body.confirmToken ?? "");
  if (!consumed) {
    return c.json({ error: "Invalid or expired token" }, 403);
  }

  const seqBeforeBackup = getLatestSeq() ?? 0;
  const backup = await createServerBackup("data_reset", {
    protected: true,
    reason: "manual_data_reset",
  });
  if ((getLatestSeq() ?? 0) !== seqBeforeBackup) {
    return c.json({ error: "Server data changed while the safety backup was being created. Retry reset." }, 409);
  }
  const result = resetDatabaseToDefaults();
  notifySyncChange(getLatestSeq());
  return c.json({ ...result, backupId: backup.id });
});

export default data;
