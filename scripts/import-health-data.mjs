#!/usr/bin/env node
/**
 * 一次性导入脚本：读 JSONL → 调 TimeData ingest API
 *
 * 用法：
 *   node scripts/import-health-data.mjs \
 *     --api-url http://localhost:3000 \
 *     --token YOUR_AUTH_TOKEN \
 *     --data-dir "D:\Desktop\Project\Projects\JsonTable-Obsidian插件\data"
 *
 * 支持的 JSONL 文件：heart_rate.jsonl, hrv.jsonl, sleep.jsonl, stress.jsonl, runs.jsonl
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

// ---- CLI args ----
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const apiUrl = getArg("api-url") || "http://localhost:3000";
const token = getArg("token");
const dataDir = getArg("data-dir");

if (!dataDir) {
  console.error("Usage: node scripts/import-health-data.mjs --api-url <url> --token <token> --data-dir <path>");
  process.exit(1);
}

// ---- Record mappers ----

function mapHeartRate(raw) {
  return {
    id: randomUUID(),
    date: raw.date,
    restingHeartRate: raw.resting_heart_rate ?? null,
    minHeartRate: raw.min_heart_rate ?? null,
    maxHeartRate: raw.max_heart_rate ?? null,
    avgHeartRate: raw.avg_heart_rate ?? null,
    last7DaysAvgRestingHeartRate: raw.last_7_days_avg_resting_heart_rate ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapHrv(raw) {
  return {
    id: randomUUID(),
    date: raw.date,
    hrvMs: raw.weekly_avg_hrv ?? raw.hrv_ms ?? 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapSleep(raw) {
  return {
    id: randomUUID(),
    date: raw.date,
    sleepStart: raw.sleep_start ?? "00:00",
    wakeTime: raw.wake_time ?? "00:00",
    adjustmentHours: raw.adjustment_hours ?? 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapStress(raw) {
  return {
    id: randomUUID(),
    date: raw.date,
    stress: raw.stress ?? 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mapRun(raw) {
  return {
    id: randomUUID(),
    date: raw.date,
    startTime: raw.start_time ?? "00:00",
    distanceKm: raw.distance_km ?? null,
    durationSeconds: raw.duration_seconds ?? null,
    averageHeartRate: raw.average_heart_rate ?? null,
    averageCadence: raw.average_cadence ?? null,
    averageStrideM: raw.average_stride_m ?? null,
    averageVerticalRatioPercent: raw.average_vertical_ratio_percent ?? null,
    averageVerticalOscillationCm: raw.average_vertical_oscillation_cm ?? null,
    averageGroundContactMs: raw.average_ground_contact_ms ?? null,
    type: raw.type ?? "",
    city: raw.city ?? "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---- Domain mapping ----

const DOMAINS = [
  { file: "heart_rate.jsonl", domain: "health_heart_rate", mapRecord: mapHeartRate },
  { file: "hrv.jsonl", domain: "health_hrv", mapRecord: mapHrv },
  { file: "sleep.jsonl", domain: "health_sleep", mapRecord: mapSleep },
  { file: "stress.jsonl", domain: "health_stress", mapRecord: mapStress },
  { file: "runs.jsonl", domain: "runs", mapRecord: mapRun },
];

const BATCH_SIZE = 200;

// ---- Import logic ----

async function importDomain({ file, domain, mapRecord }) {
  const filePath = resolve(dataDir, file);
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    console.log(`  ⏭  ${file} not found, skipping`);
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  if (lines.length === 0) {
    console.log(`  ⏭  ${file} is empty, skipping`);
    return;
  }

  const records = lines.map((line) => mapRecord(JSON.parse(line)));
  console.log(`  📦 ${domain}: ${records.length} records`);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${apiUrl}/api/health/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify({ domain, records: batch }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  ❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed (${res.status}): ${body}`);
      continue;
    }

    const result = await res.json();
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);
    console.log(`     batch ${batchNum}/${totalBatches}: imported=${result.imported} updated=${result.updated}${result.errors?.length ? ` errors=${result.errors.length}` : ""}`);
  }
}

// ---- Main ----

async function main() {
  console.log(`\n🚀 Importing health data from ${dataDir}`);
  console.log(`   API: ${apiUrl}`);
  console.log(`   Auth: ${token ? "Bearer token provided" : "No auth (dev mode)"}\n`);

  for (const config of DOMAINS) {
    await importDomain(config);
  }

  console.log("\n✅ Import complete!\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
