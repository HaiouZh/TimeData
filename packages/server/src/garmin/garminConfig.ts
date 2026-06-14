import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getDb } from "../db/connection.js";

export const DEFAULT_INITIAL_BACKFILL_DAYS = 7;

export interface GarminConfig {
  email: string;
  password: string;
  isCn: boolean;
  schedule: string;
  enabled: boolean;
  lastFetchDate: string;
  initialBackfillDays: number;
}

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

export function getServerConfig(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM server_config WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setServerConfig(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO server_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, new Date().toISOString());
}

function parseInitialBackfillDays(value: string | null): number {
  if (!value) return DEFAULT_INITIAL_BACKFILL_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
    return DEFAULT_INITIAL_BACKFILL_DAYS;
  }
  return parsed;
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
    initialBackfillDays: parseInitialBackfillDays(
      getServerConfig("garmin.initialBackfillDays"),
    ),
  };
}

export function saveGarminConfig(config: Partial<GarminConfig>): void {
  if (config.email !== undefined) setServerConfig("garmin.email", config.email);
  if (config.password !== undefined && config.password !== "") {
    setServerConfig("garmin.password", encrypt(config.password));
  }
  if (config.isCn !== undefined) {
    setServerConfig("garmin.isCn", String(config.isCn));
  }
  if (config.schedule !== undefined) {
    setServerConfig("garmin.schedule", config.schedule);
  }
  if (config.enabled !== undefined) {
    setServerConfig("garmin.enabled", String(config.enabled));
  }
  if (config.lastFetchDate !== undefined) {
    setServerConfig("garmin.lastFetchDate", config.lastFetchDate);
  }
  if (config.initialBackfillDays !== undefined) {
    setServerConfig(
      "garmin.initialBackfillDays",
      String(config.initialBackfillDays),
    );
  }
}

export function setGarminLastFetchDate(date: string): void {
  setServerConfig("garmin.lastFetchDate", date);
}
