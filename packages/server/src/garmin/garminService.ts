import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getSyncDomain } from "@timedata/shared";
import type { SyncChange } from "@timedata/shared";
import type { Database } from "better-sqlite3";
import { getDb } from "../db/connection.js";
import { applyChange } from "../sync/resolver.js";
import { getLatestSeq } from "../sync/seq.js";
import { notifySyncChange } from "../sync/notifier.js";
import { setGarminLastFetchDate } from "./garminConfig.js";
import type { GarminConfig } from "./garminConfig.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_EXPLICIT_RANGE_DAYS = 90;

const INGEST_DOMAINS = [
  "health_heart_rate",
  "health_hrv",
  "health_sleep",
  "health_stress",
  "runs",
] as const;

const DAILY_HEALTH_DOMAINS = [
  "health_heart_rate",
  "health_hrv",
  "health_sleep",
  "health_stress",
] as const;

type IngestDomain = (typeof INGEST_DOMAINS)[number];
type DailyGarminDomain = (typeof DAILY_HEALTH_DOMAINS)[number];
export type GarminFetchTrigger = "manual" | "scheduled" | "test";
export type GarminFetchStatus = "success" | "partial_success" | "no_op" | "failed";

export interface GarminFetchError {
  code: string;
  message: string;
  domain?: string;
  date?: string;
}

export interface GarminFetchResult {
  success: boolean;
  status: GarminFetchStatus;
  trigger: GarminFetchTrigger;
  runId: string;
  startDate: string;
  endDate: string;
  counts: Record<string, number>;
  errors: GarminFetchError[];
  duration: number; // ms
}

export interface GarminFetchRangeInput {
  startDate?: string;
  endDate?: string;
  days?: number;
}

export interface GarminFetchRangeConfig {
  initialBackfillDays: number;
}

export interface GarminFetchRange {
  noOp: boolean;
  startDate: string;
  endDate: string;
}

export interface GarminFetchAuditInput {
  runId: string;
  trigger: GarminFetchTrigger;
  status: GarminFetchStatus;
  startDate: string;
  endDate: string;
  counts: Record<string, number>;
  errors: GarminFetchError[];
  latestSeqBefore: number | null;
  latestSeqAfter: number | null;
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

function ymdFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateFromYmd(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  return ymdFromDate(new Date(dateFromYmd(date).getTime() + days * MS_PER_DAY));
}

function inclusiveDays(startDate: string, endDate: string): number {
  return Math.floor((dateFromYmd(endDate).getTime() - dateFromYmd(startDate).getTime()) / MS_PER_DAY) + 1;
}

function yesterday(now = new Date()): string {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return ymdFromDate(new Date(utcMidnight - MS_PER_DAY));
}

function createRunId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function garminError(code: string, message: string, extra?: Omit<GarminFetchError, "code" | "message">): GarminFetchError {
  return { code, message, ...extra };
}

function logGarmin(event: string, detail: Record<string, unknown>): void {
  console.log(`[garmin] ${event} ${JSON.stringify(detail)}`);
}

export function resolveGarminScriptPath(candidates = [
  "/app/garminFetch.py",
  resolve(__dirname, "garminFetch.py"),
  resolve(process.cwd(), "packages/server/src/garmin/garminFetch.py"),
]): string {
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  throw new Error(`script_not_found: Garmin fetch script not found in ${candidates.join(", ")}`);
}

export function getGarminDailyLatestDates(db: Database = getDb()): Partial<Record<DailyGarminDomain, string>> {
  const result: Partial<Record<DailyGarminDomain, string>> = {};
  for (const domain of DAILY_HEALTH_DOMAINS) {
    const row = db
      .prepare(`SELECT MAX(date) AS latest FROM ${domain} WHERE COALESCE(sync_tombstone, 0) = 0`)
      .get() as { latest: string | null } | undefined;
    if (row?.latest) result[domain] = row.latest;
  }
  return result;
}

export function resolveGarminFetchRange(
  input: GarminFetchRangeInput,
  config: GarminFetchRangeConfig,
  latestDates: Partial<Record<DailyGarminDomain, string>>,
  now = new Date(),
): GarminFetchRange {
  const end = yesterday(now);
  const hasStart = Boolean(input.startDate);
  const hasEnd = Boolean(input.endDate);
  const hasDays = input.days !== undefined;

  if (hasDays && (hasStart || hasEnd)) {
    throw new Error("cannot combine dates with days");
  }
  if (hasStart !== hasEnd) {
    throw new Error("startDate and endDate must be provided together");
  }
  if (hasDays) {
    const days = input.days as number;
    if (!Number.isInteger(days) || days < 1 || days > MAX_EXPLICIT_RANGE_DAYS) {
      throw new Error("days must be an integer between 1 and 90");
    }
    return { noOp: false, startDate: addDays(end, -(days - 1)), endDate: end };
  }
  if (hasStart && hasEnd) {
    const startDate = input.startDate as string;
    const endDate = input.endDate as string;
    if (startDate > endDate) throw new Error("startDate cannot be after endDate");
    if (endDate > end) throw new Error("endDate cannot be after yesterday");
    if (inclusiveDays(startDate, endDate) > MAX_EXPLICIT_RANGE_DAYS) {
      throw new Error("range cannot exceed 90 days");
    }
    return { noOp: false, startDate, endDate };
  }

  const nextDates = Object.values(latestDates).map((date) => addDays(date, 1));
  const startDate = nextDates.length > 0
    ? nextDates.sort()[0]
    : addDays(end, -(config.initialBackfillDays - 1));
  if (startDate > end) return { noOp: true, startDate: end, endDate: end };
  return { noOp: false, startDate, endDate: end };
}

export function getGarminStatus(): GarminServiceStatus {
  return {
    enabled: scheduledTime !== null,
    lastFetch: lastResult,
    nextScheduled: scheduledTime,
    running: isRunning,
  };
}

export function createGarminNoOpResult(
  trigger: GarminFetchTrigger,
  startDate: string,
  endDate: string,
  startedAt = Date.now(),
): GarminFetchResult {
  const result = {
    success: true,
    status: "no_op",
    trigger,
    runId: createRunId(),
    startDate,
    endDate,
    counts: Object.fromEntries(INGEST_DOMAINS.map((domain) => [domain, 0])),
    errors: [],
    duration: Date.now() - startedAt,
  } satisfies GarminFetchResult;
  lastResult = result;
  return result;
}

export function recordGarminFetchAudit(db: Database, input: GarminFetchAuditInput): void {
  try {
    const recordCount = Object.values(input.counts).reduce((sum, count) => sum + count, 0);
    db.prepare(
      "INSERT INTO sync_logs (device, action, detail, record_count) VALUES (?, ?, ?, ?)",
    ).run(
      "garmin",
      "garmin_fetch",
      JSON.stringify(input),
      recordCount,
    );
  } catch (error) {
    console.warn("[garmin] sync_log_failed", error instanceof Error ? error.message : String(error));
  }
}

export interface GarminIngestResult {
  applied: number;
  validationErrors: number;
  errors: GarminFetchError[];
}

const DAILY_HEALTH_TABLES = new Set<string>(DAILY_HEALTH_DOMAINS);

/**
 * Upsert one domain's fetched records into the DB inside a single transaction.
 *
 * Daily health tables enforce one row per date (UNIQUE(date) WHERE sync_tombstone = 0).
 * Garmin assigns deterministic per-date ids, but a date may already hold a row written
 * under a different id (client app sync or an older import scheme). Inserting our id then
 * collides on the date index — a conflict the generic ON CONFLICT(id) upsert does not
 * handle — which throws and rolls back the whole domain. We reconcile by reusing the
 * existing row's id so the write updates in place instead of colliding.
 */
export function ingestGarminDomain(
  db: Database,
  domain: IngestDomain,
  records: unknown[],
  serverNow: string,
): GarminIngestResult {
  const sharedDomain = getSyncDomain(domain);
  const errors: GarminFetchError[] = [];
  let applied = 0;
  let validationErrors = 0;

  db.transaction(() => {
    for (const record of records) {
      const parsed = sharedDomain.dataSchema.safeParse(record);
      if (!parsed.success) {
        validationErrors += 1;
        const raw = record as Record<string, unknown>;
        errors.push(garminError(
          "validation_failed",
          parsed.error.issues.map((i) => i.message).join(", "),
          { domain, date: typeof raw.date === "string" ? raw.date : undefined },
        ));
        continue;
      }
      const recordData = parsed.data as Record<string, unknown>;
      let recordId = recordData.id as string;
      let data: unknown = parsed.data;

      if (DAILY_HEALTH_TABLES.has(domain) && typeof recordData.date === "string") {
        const byDate = db
          .prepare(`SELECT id FROM ${domain} WHERE date = ? AND COALESCE(sync_tombstone, 0) = 0`)
          .get(recordData.date) as { id: string } | undefined;
        if (byDate && byDate.id !== recordId) {
          recordId = byDate.id;
          data = { ...recordData, id: byDate.id };
        }
      }

      const existing = db
        .prepare(`SELECT id FROM ${domain} WHERE id = ?`)
        .get(recordId) as { id: string } | undefined;
      const change = {
        tableName: domain,
        recordId,
        action: existing ? "update" : "create",
        data,
        timestamp: serverNow,
      } as SyncChange;
      if (applyChange(change).status === "applied") applied += 1;
    }
  })();

  return { applied, validationErrors, errors };
}

export async function fetchGarminData(
  config: GarminConfig,
  startDate: string,
  endDate: string,
  options: { trigger?: GarminFetchTrigger; runId?: string } = {},
): Promise<GarminFetchResult> {
  const trigger = options.trigger ?? "manual";
  const runId = options.runId ?? createRunId();
  if (isRunning) {
    return {
      success: false,
      status: "failed",
      trigger,
      runId,
      startDate,
      endDate,
      counts: {},
      errors: [garminError("already_running", "Garmin fetch already running")],
      duration: 0,
    };
  }
  isRunning = true;
  const t0 = Date.now();
  const errors: GarminFetchError[] = [];
  const counts: Record<string, number> = {};
  let latestSeqBefore: number | null = null;
  let latestSeqAfter: number | null = null;

  try {
    latestSeqBefore = getLatestSeq();
    const tokenDir = resolve(
      process.env.UPDATE_STATE_DIR || "/app/data",
      "garmin_tokens",
    );
    const scriptPath = resolveGarminScriptPath();
    logGarmin("fetch_start", { runId, trigger, startDate, endDate, isCn: config.isCn, scriptPath });
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
      const result = ingestGarminDomain(db, domain, records, serverNow);
      counts[domain] = result.applied;
      errors.push(...result.errors);
      logGarmin("domain_written", {
        runId,
        domain,
        fetched: records.length,
        applied: result.applied,
        validationErrors: result.validationErrors,
      });
    }

    latestSeqAfter = getLatestSeq();
    if (latestSeqAfter !== latestSeqBefore) notifySyncChange(latestSeqAfter);

    const appliedTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const status: GarminFetchStatus = errors.length === 0
      ? "success"
      : appliedTotal > 0
        ? "partial_success"
        : "failed";
    const result: GarminFetchResult = {
      success: status !== "failed",
      status,
      trigger,
      runId,
      startDate,
      endDate,
      counts,
      errors,
      duration: Date.now() - t0,
    };
    recordGarminFetchAudit(db, { ...result, latestSeqBefore, latestSeqAfter });
    logGarmin("fetch_end", {
      runId,
      trigger,
      status,
      duration: result.duration,
      counts,
      errorCodes: errors.map((error) => error.code),
      latestSeqBefore,
      latestSeqAfter,
    });
    lastResult = result;
    return result;
  } catch (err: unknown) {
    const code = err instanceof Error && err.message.includes("script_not_found")
      ? "script_not_found"
      : "fetch_failed";
    logGarmin("fetch_error", { runId, code, message: err instanceof Error ? err.message : String(err) });
    const db = getDb();
    latestSeqAfter = getLatestSeq();
    const result: GarminFetchResult = {
      success: false,
      status: "failed",
      trigger,
      runId,
      startDate,
      endDate,
      counts,
      errors: [
        ...errors,
        garminError(code, err instanceof Error ? err.message : String(err)),
      ],
      duration: Date.now() - t0,
    };
    recordGarminFetchAudit(db, { ...result, latestSeqBefore, latestSeqAfter });
    logGarmin("fetch_end", {
      runId,
      trigger,
      status: result.status,
      duration: result.duration,
      counts,
      errorCodes: result.errors.map((error) => error.code),
      latestSeqBefore,
      latestSeqAfter,
    });
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
    const db = getDb();
    const range = resolveGarminFetchRange(
      {},
      config,
      getGarminDailyLatestDates(db),
      new Date(),
    );
    if (range.noOp) {
      const latestSeq = getLatestSeq();
      const result = createGarminNoOpResult("scheduled", range.startDate, range.endDate);
      recordGarminFetchAudit(db, { ...result, latestSeqBefore: latestSeq, latestSeqAfter: latestSeq });
      console.log("[garmin] No new dates to fetch");
    } else {
      console.log(`[garmin] Scheduled fetch: ${range.startDate} -> ${range.endDate}`);
      const result = await fetchGarminData(config, range.startDate, range.endDate, { trigger: "scheduled" });
      if (result.success && result.status !== "no_op") setGarminLastFetchDate(result.endDate);
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
