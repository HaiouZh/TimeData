import { Hono } from "hono";
import { z } from "zod";
import { getSyncDomain } from "@timedata/shared";
import type { SyncChange } from "@timedata/shared";
import { getDb } from "../db/connection.js";
import { applyChange } from "../sync/resolver.js";
import { getLatestSeq } from "../sync/seq.js";
import { notifySyncChange } from "../sync/notifier.js";

const INGEST_DOMAINS = new Set([
  "health_heart_rate", "health_hrv", "health_sleep", "health_stress", "runs",
]);

const IngestRequestSchema = z.object({
  domain: z.string().min(1),
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
});

const ingestRoutes = new Hono();

ingestRoutes.post("/ingest", async (c) => {
  const body = await c.req.json();
  const parseResult = IngestRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: "invalid_request", details: parseResult.error.issues }, 400);
  }
  const { domain, records } = parseResult.data;

  if (!INGEST_DOMAINS.has(domain)) {
    return c.json({ error: `domain '${domain}' is not in the ingest allowlist` }, 400);
  }

  const sharedDomain = getSyncDomain(domain);
  const db = getDb();
  const serverNow = new Date().toISOString();
  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  const run = db.transaction(() => {
    for (const record of records) {
      const parsed = sharedDomain.dataSchema.safeParse(record);
      if (!parsed.success) {
        const dateHint = (record as Record<string, unknown>).date ?? "unknown";
        errors.push(`${dateHint}: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
        continue;
      }

      const data = parsed.data as Record<string, unknown>;
      const recordId = data.id as string;

      const existing = db.prepare(`SELECT id FROM ${domain} WHERE id = ?`).get(recordId) as
        | { id: string }
        | undefined;
      const action: SyncChange["action"] = existing ? "update" : "create";

      const change = {
        tableName: domain,
        recordId,
        action,
        data: parsed.data,
        timestamp: serverNow,
      } as SyncChange;

      applyChange(change);

      if (existing) updated++;
      else imported++;
    }
  });

  run();
  notifySyncChange(getLatestSeq());

  return c.json({ imported, updated, skipped: 0, errors });
});

export { ingestRoutes };
