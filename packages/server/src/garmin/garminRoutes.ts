import { Hono } from "hono";
import { z } from "zod";
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { getDb } from "../db/connection.js";
import {
  fetchGarminData,
  getGarminStatus,
  updateSchedule,
  stopSchedule,
} from "./garminService.js";
import type { GarminConfig } from "./garminService.js";

const garminRoutes = new Hono();

// ── Encryption helpers ──────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const token = process.env.AUTH_TOKEN || "default-dev-key";
  return createHash("sha256").update(token).digest();
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(data: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(data, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

// ── Server config helpers ───────────────────────────────────────────

function getServerConfig(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM server_config WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setServerConfig(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO server_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, new Date().toISOString());
}

export function loadGarminConfig(): GarminConfig {
  const encryptedPwd = getServerConfig("garmin.password");
  let password = "";
  if (encryptedPwd) {
    try {
      password = decrypt(encryptedPwd);
    } catch {
      password = "";
    }
  }
  return {
    email: getServerConfig("garmin.email") || "",
    password,
    isCn: getServerConfig("garmin.isCn") !== "false",
    schedule: getServerConfig("garmin.schedule") || "",
    enabled: getServerConfig("garmin.enabled") === "true",
    lastFetchDate: getServerConfig("garmin.lastFetchDate") || "",
  };
}

function saveGarminConfig(config: Partial<GarminConfig>): void {
  if (config.email !== undefined) setServerConfig("garmin.email", config.email);
  if (config.password !== undefined && config.password !== "")
    setServerConfig("garmin.password", encrypt(config.password));
  if (config.isCn !== undefined)
    setServerConfig("garmin.isCn", String(config.isCn));
  if (config.schedule !== undefined)
    setServerConfig("garmin.schedule", config.schedule);
  if (config.enabled !== undefined)
    setServerConfig("garmin.enabled", String(config.enabled));
  if (config.lastFetchDate !== undefined)
    setServerConfig("garmin.lastFetchDate", config.lastFetchDate);
}

// ── Routes ──────────────────────────────────────────────────────────

garminRoutes.get("/config", (c) => {
  const config = loadGarminConfig();
  return c.json({
    email: config.email,
    password: config.password ? "********" : "",
    isCn: config.isCn,
    schedule: config.schedule,
    enabled: config.enabled,
    lastFetchDate: config.lastFetchDate,
  });
});

const ConfigUpdateSchema = z
  .object({
    email: z.string().optional(),
    password: z.string().optional(),
    isCn: z.boolean().optional(),
    schedule: z
      .string()
      .regex(/^(\d{2}:\d{2})?$/)
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

garminRoutes.put("/config", async (c) => {
  const body = await c.req.json();
  const parsed = ConfigUpdateSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      { error: "invalid_config", details: parsed.error.issues },
      400,
    );

  saveGarminConfig(parsed.data);
  const config = loadGarminConfig();

  if (config.enabled && config.schedule) {
    updateSchedule(config);
  } else {
    stopSchedule();
  }

  return c.json({ ok: true });
});

const FetchRequestSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

garminRoutes.post("/fetch", async (c) => {
  const config = loadGarminConfig();
  if (!config.email || !config.password) {
    return c.json({ error: "Garmin credentials not configured" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = FetchRequestSchema.safeParse(body);
  if (!parsed.success)
    return c.json(
      { error: "invalid_request", details: parsed.error.issues },
      400,
    );

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const endDate =
    parsed.data?.endDate || yesterday.toISOString().slice(0, 10);
  const startDate =
    parsed.data?.startDate ||
    (() => {
      if (config.lastFetchDate) {
        const d = new Date(config.lastFetchDate);
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      }
      return endDate;
    })();

  const result = await fetchGarminData(config, startDate, endDate);

  if (result.success) {
    setServerConfig("garmin.lastFetchDate", endDate);
  }

  return c.json(result);
});

garminRoutes.get("/status", (c) => {
  return c.json(getGarminStatus());
});

garminRoutes.post("/test", async (c) => {
  const config = loadGarminConfig();
  if (!config.email || !config.password) {
    return c.json({ error: "Garmin credentials not configured" }, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  const result = await fetchGarminData(config, today, today);
  return c.json({ ok: result.success, errors: result.errors });
});

export { garminRoutes };
