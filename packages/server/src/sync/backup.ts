import fs from "node:fs";
import path from "node:path";
import { getDb, getDbPath } from "../db/connection.js";

export type BackupRetention = "recent" | "snapshot" | "protected" | "deletable";

export interface ServerBackup {
  id: string;
  path: string;
  createdAt: string;
  operation: string;
  protected: boolean;
  reason: string | null;
  relatedSyncLogId: number | null;
  details: Record<string, unknown> | null;
}

export interface ServerBackupManifestEntry {
  id: string;
  fileName: string;
  operation: string;
  createdAt: string;
  protected: boolean;
  reason: string | null;
  relatedSyncLogId: number | null;
  details: Record<string, unknown> | null;
}

export interface ServerBackupManifest {
  backups: Record<string, ServerBackupManifestEntry>;
}

export interface CreateServerBackupOptions {
  protected?: boolean;
  reason?: string | null;
  relatedSyncLogId?: number | null;
  details?: Record<string, unknown> | null;
}

export interface UpdateServerBackupOptions {
  protected?: boolean;
  reason?: string | null;
  relatedSyncLogId?: number | null;
  details?: Record<string, unknown> | null;
}

function safeOperationName(operation: string): string {
  return operation.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getBackupDir(): string {
  return path.join(path.dirname(getDbPath()), "backups");
}

function manifestPath(): string {
  return path.join(getBackupDir(), "manifest.json");
}

export function readBackupManifest(): ServerBackupManifest {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(), "utf8")) as ServerBackupManifest;
    return { backups: parsed.backups ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[backup] failed to read manifest", error);
    }
    return { backups: {} };
  }
}

function writeBackupManifest(manifest: ServerBackupManifest): void {
  fs.mkdirSync(getBackupDir(), { recursive: true });
  fs.writeFileSync(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
}

function updateBackupManifestEntry(id: string, patch: UpdateServerBackupOptions): ServerBackupManifestEntry | null {
  const manifest = readBackupManifest();
  const entry = manifest.backups[id];
  if (!entry) return null;

  manifest.backups[id] = {
    ...entry,
    protected: patch.protected ?? entry.protected,
    reason: patch.reason ?? entry.reason,
    relatedSyncLogId: patch.relatedSyncLogId ?? entry.relatedSyncLogId,
    details: patch.details ?? entry.details,
  };
  writeBackupManifest(manifest);
  return manifest.backups[id];
}

export function markServerBackupProtected(
  id: string,
  patch: UpdateServerBackupOptions,
): ServerBackupManifestEntry | null {
  return updateBackupManifestEntry(id, patch);
}

export function classifyBackupRetention(
  createdAt: string,
  protectedBackup: boolean,
  now = new Date(),
): BackupRetention {
  if (protectedBackup) return "protected";
  const ageMs = now.getTime() - Date.parse(createdAt);
  if (ageMs <= 15 * 24 * 60 * 60 * 1000) return "recent";
  return "deletable";
}

export async function createServerBackup(
  operation: string,
  options: CreateServerBackupOptions = {},
): Promise<ServerBackup> {
  const createdAt = new Date().toISOString();
  const id = `${safeOperationName(operation)}-${createdAt.replace(/[:.]/g, "-")}`;
  const backupDir = getBackupDir();
  const fileName = `${id}.db`;
  const backupPath = path.join(backupDir, fileName);

  fs.mkdirSync(backupDir, { recursive: true });
  await getDb().backup(backupPath);

  const entry: ServerBackupManifestEntry = {
    id,
    fileName,
    operation,
    createdAt,
    protected: Boolean(options.protected),
    reason: options.reason ?? null,
    relatedSyncLogId: options.relatedSyncLogId ?? null,
    details: options.details ?? null,
  };
  const manifest = readBackupManifest();
  manifest.backups[id] = entry;
  writeBackupManifest(manifest);

  const result = { ...entry, path: backupPath };
  try {
    const removed = cleanupServerBackups();
    if (removed.length > 0) {
      console.log("[backup] cleanup removed old backups", {
        backupId: id,
        operation,
        removedCount: removed.length,
      });
    }
  } catch (error) {
    console.warn("[backup] cleanup failed", { backupId: id, operation, error });
  }

  return result;
}

function cleanupWindowKey(createdAt: string, now: Date): number {
  const created = new Date(createdAt);
  const createdDay = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = Math.floor((nowDay - createdDay) / (24 * 60 * 60 * 1000));
  return Math.floor((ageDays - 16) / 15);
}

export function cleanupServerBackups(now = new Date()): string[] {
  const manifest = readBackupManifest();
  const entries = Object.values(manifest.backups);
  const keepIds = new Set<string>();

  for (const entry of entries) {
    if (entry.protected || classifyBackupRetention(entry.createdAt, entry.protected, now) === "recent") {
      keepIds.add(entry.id);
    }
  }

  const oldNormalByWindow = new Map<number, ServerBackupManifestEntry>();
  for (const entry of entries) {
    if (entry.protected || keepIds.has(entry.id)) continue;
    const key = cleanupWindowKey(entry.createdAt, now);
    const current = oldNormalByWindow.get(key);
    if (!current || entry.createdAt > current.createdAt) {
      oldNormalByWindow.set(key, entry);
    }
  }

  for (const entry of oldNormalByWindow.values()) {
    keepIds.add(entry.id);
  }

  const removed: string[] = [];
  for (const entry of entries) {
    if (keepIds.has(entry.id)) continue;
    fs.rmSync(path.join(getBackupDir(), entry.fileName), { force: true });
    delete manifest.backups[entry.id];
    removed.push(entry.id);
  }

  writeBackupManifest(manifest);
  return removed.sort();
}
