import { execFile } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSyncDomain } from "@timedata/shared";
import type { SyncChange } from "@timedata/shared";
import { getDb } from "../db/connection.js";
import { applyChange } from "../sync/resolver.js";
import { getLatestSeq } from "../sync/seq.js";
import { notifySyncChange } from "../sync/notifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * In production (Docker), garminFetch.py is copied to /app/garminFetch.py.
 * In dev, it lives alongside this compiled file in the source tree.
 */
function getScriptPath(): string {
  const prodPath = "/app/garminFetch.py";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:fs").accessSync(prodPath);
    return prodPath;
  } catch {
    return resolve(__dirname, "garminFetch.py");
  }
}

const INGEST_DOMAINS = [
  "health_heart_rate",
  "health_hrv",
  "health_sleep",
  "health_stress",
  "runs",
] as const;

export interface GarminConfig {
  email: string;
  password: string;
  isCn: boolean;
  schedule: string; // HH:MM or empty
  enabled: boolean;
  lastFetchDate: string; // YYYY-MM-DD
}

export interface GarminFetchResult {
  success: boolean;
  startDate: string;
  endDate: string;
  counts: Record<string, number>;
  errors: string[];
  duration: number; // ms
}

export interface GarminServiceStatus {
  enabled: boolean;
  lastFetch: GarminFetchResult | null;
  nextScheduled: string | null;
  running: boolean;
}

let lastResult: GarminFetchResult | null = null;
let isRunning = false;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledTime: string | null = null;

export function getGarminStatus(): GarminServiceStatus {
  return {
    enabled: scheduledTime !== null,
    lastFetch: lastResult,
    nextScheduled: scheduledTime,
    running: isRunning,
  };
}

export async function fetchGarminData(
  config: GarminConfig,
  startDate: string,
  endDate: string,
): Promise<GarminFetchResult> {
  if (isRunning) throw new Error("Garmin fetch already running");
  isRunning = true;
  const t0 = Date.now();
  const errors: string[] = [];
  const counts: Record<string, number> = {};

  try {
    const tokenDir = resolve(
      process.env.UPDATE_STATE_DIR || "/app/data",
      "garmin_tokens",
    );
    const scriptPath = getScriptPath();
    const args = [
      scriptPath,
      "--email",
      config.email,
      "--password",
      config.password,
      config.isCn ? "--is-cn" : "--no-cn",
      "--start",
      startDate,
      "--end",
      endDate,
      "--token-dir",
      tokenDir,
    ];

    const stdout = await new Promise<string>((ok, fail) => {
      execFile(
        "python3",
        args,
        { maxBuffer: 50 * 1024 * 1024, timeout: 600_000 },
        (err, stdout, stderr) => {
          if (stderr) {
            for (const line of stderr.split("\n")) {
              if (line.trim()) console.log(`[garmin] ${line}`);
            }
          }
          if (err) fail(new Error(err.message + (stderr ? `\n${stderr}` : "")));
          else ok(stdout);
        },
      );
    });

    const data = JSON.parse(stdout) as Record<string, unknown[]>;
    const db = getDb();
    const serverNow = new Date().toISOString();

    for (const domain of INGEST_DOMAINS) {
      const records = data[domain] ?? [];
      counts[domain] = 0;
      const sharedDomain = getSyncDomain(domain);

      db.transaction(() => {
        for (const record of records) {
          const parsed = sharedDomain.dataSchema.safeParse(record);
          if (!parsed.success) {
            errors.push(
              `${domain}: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
            );
            continue;
          }
          const recordData = parsed.data as Record<string, unknown>;
          const recordId = recordData.id as string;
          const existing = db
            .prepare(`SELECT id FROM ${domain} WHERE id = ?`)
            .get(recordId) as { id: string } | undefined;
          const change = {
            tableName: domain,
            recordId,
            action: existing ? "update" : "create",
            data: parsed.data,
            timestamp: serverNow,
          } as SyncChange;
          applyChange(change);
          counts[domain] = (counts[domain] ?? 0) + 1;
        }
      })();
    }

    notifySyncChange(getLatestSeq());

    const result: GarminFetchResult = {
      success: true,
      startDate,
      endDate,
      counts,
      errors,
      duration: Date.now() - t0,
    };
    lastResult = result;
    return result;
  } catch (err: unknown) {
    const result: GarminFetchResult = {
      success: false,
      startDate,
      endDate,
      counts,
      errors: [
        ...errors,
        err instanceof Error ? err.message : String(err),
      ],
      duration: Date.now() - t0,
    };
    lastResult = result;
    return result;
  } finally {
    isRunning = false;
  }
}

function scheduleNextFetch(config: GarminConfig): void {
  if (scheduledTimer) clearTimeout(scheduledTimer);
  scheduledTimer = null;
  scheduledTime = null;

  if (!config.enabled || !config.schedule) return;

  const [h, m] = config.schedule.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const delay = next.getTime() - now.getTime();
  scheduledTime = config.schedule;

  scheduledTimer = setTimeout(async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const endDate = yesterday.toISOString().slice(0, 10);
    const startDate = config.lastFetchDate
      ? (() => {
          const d = new Date(config.lastFetchDate);
          d.setDate(d.getDate() + 1);
          return d.toISOString().slice(0, 10);
        })()
      : endDate;
    if (startDate > endDate) {
      console.log("[garmin] No new dates to fetch");
    } else {
      console.log(`[garmin] Scheduled fetch: ${startDate} -> ${endDate}`);
      await fetchGarminData(config, startDate, endDate);
    }
    scheduleNextFetch(config); // reschedule for next day
  }, delay);

  console.log(
    `[garmin] Next fetch scheduled at ${config.schedule} (in ${Math.round(delay / 60000)}m)`,
  );
}

export function updateSchedule(config: GarminConfig): void {
  scheduleNextFetch(config);
}

export function stopSchedule(): void {
  if (scheduledTimer) clearTimeout(scheduledTimer);
  scheduledTimer = null;
  scheduledTime = null;
}
