import type {
  AdminRequestLogClientHint,
  AdminRequestLogOutcome,
  AdminRequestLogRow,
  AdminRequestLogTokenTier,
} from "@timedata/shared";
import { getDb } from "../db/connection.js";

export interface RequestLogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  outcome: AdminRequestLogOutcome;
  tokenTier: AdminRequestLogTokenTier;
  ip: string | null;
  userAgent: string | null;
  clientHint: AdminRequestLogClientHint;
  deviceLabel: string | null;
  durationMs: number;
}

export interface RequestLogFilter {
  limit?: number;
  status?: number;
  outcome?: AdminRequestLogOutcome;
  tokenTier?: AdminRequestLogTokenTier;
  clientHint?: AdminRequestLogClientHint;
}

type RequestLogDbRow = {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  status: number;
  outcome: AdminRequestLogOutcome;
  token_tier: AdminRequestLogTokenTier;
  ip: string | null;
  user_agent: string | null;
  client_hint: AdminRequestLogClientHint;
  device_label: string | null;
  duration_ms: number;
};

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(500, Math.floor(limit ?? 100)));
}

function mapRequestLog(row: RequestLogDbRow): AdminRequestLogRow {
  return {
    id: row.id,
    timestamp: row.timestamp,
    method: row.method,
    path: row.path,
    status: row.status,
    outcome: row.outcome,
    tokenTier: row.token_tier,
    ip: row.ip,
    userAgent: row.user_agent,
    clientHint: row.client_hint,
    deviceLabel: row.device_label,
    durationMs: row.duration_ms,
  };
}

export function recordRequestLog(entry: RequestLogEntry): void {
  getDb()
    .prepare(`
      INSERT INTO api_request_logs (
        timestamp,
        method,
        path,
        status,
        outcome,
        token_tier,
        ip,
        user_agent,
        client_hint,
        device_label,
        duration_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      entry.timestamp,
      entry.method,
      entry.path,
      entry.status,
      entry.outcome,
      entry.tokenTier,
      entry.ip,
      entry.userAgent,
      entry.clientHint,
      entry.deviceLabel,
      entry.durationMs,
    );
}

export function queryRequestLogs(filter: RequestLogFilter = {}): AdminRequestLogRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter.outcome !== undefined) {
    conditions.push("outcome = ?");
    params.push(filter.outcome);
  }
  if (filter.tokenTier !== undefined) {
    conditions.push("token_tier = ?");
    params.push(filter.tokenTier);
  }
  if (filter.clientHint !== undefined) {
    conditions.push("client_hint = ?");
    params.push(filter.clientHint);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(normalizeLimit(filter.limit));

  return (getDb()
    .prepare(`
      SELECT
        id,
        timestamp,
        method,
        path,
        status,
        outcome,
        token_tier,
        ip,
        user_agent,
        client_hint,
        device_label,
        duration_ms
      FROM api_request_logs
      ${whereSql}
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `)
    .all(...params) as RequestLogDbRow[]).map(mapRequestLog);
}

export function pruneRequestLogs(opts: { maxAgeDays?: number; maxRows?: number } = {}): void {
  const maxAgeDays = opts.maxAgeDays ?? 30;
  const maxRows = opts.maxRows ?? 5000;
  const db = getDb();

  if (maxAgeDays > 0) {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("DELETE FROM api_request_logs WHERE timestamp < ?").run(cutoff);
  }

  if (maxRows > 0) {
    db.prepare(`
      DELETE FROM api_request_logs
      WHERE id NOT IN (
        SELECT id
        FROM api_request_logs
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      )
    `).run(Math.floor(maxRows));
  }
}
