import { toAppLocalDateTimeString } from "../lib/timezone.js";
import { createServerBackup, readBackupManifest, readBackupMeta, writeBackupMeta } from "./backup.js";
import { getLatestSeq } from "./seq.js";

export interface DailyBackupResult {
  created: boolean;
  backupId: string | null;
  reason: "created" | "disabled" | "before_time" | "already_today" | "no_change";
}

let dailyBackupGate: Promise<void> = Promise.resolve();

function localDate(value: Date): string {
  return toAppLocalDateTimeString(value).slice(0, 10);
}

function localTime(value: Date): string {
  return toAppLocalDateTimeString(value).slice(11, 16);
}

async function runDailyBackupIfDueLocked(now: Date): Promise<DailyBackupResult> {
  const meta = readBackupMeta();
  if (!meta.dailyBackup.enabled) return { created: false, backupId: null, reason: "disabled" };
  if (localTime(now) < meta.dailyBackup.timeOfDay) return { created: false, backupId: null, reason: "before_time" };

  const today = localDate(now);
  const hasToday = Object.values(readBackupManifest().backups).some(
    (entry) => entry.operation === "auto_daily" && localDate(new Date(entry.createdAt)) === today,
  );
  if (hasToday) return { created: false, backupId: null, reason: "already_today" };

  const latestSeq = getLatestSeq() ?? 0;
  if (latestSeq <= meta.lastDailySeq) return { created: false, backupId: null, reason: "no_change" };

  const backup = await createServerBackup("auto_daily");
  writeBackupMeta({ lastDailySeq: latestSeq });
  return { created: true, backupId: backup.id, reason: "created" };
}

export async function runDailyBackupIfDue(now = new Date()): Promise<DailyBackupResult> {
  const previous = dailyBackupGate;
  let release!: () => void;
  dailyBackupGate = new Promise((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await runDailyBackupIfDueLocked(now);
  } finally {
    release();
  }
}
