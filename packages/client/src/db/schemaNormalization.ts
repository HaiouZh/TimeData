import { safeGetItem, safeSetItem } from "../lib/safeStorage.js";
import { STORAGE_KEYS } from "../lib/storageKeys.js";
import { CLIENT_SYNC_DOMAINS } from "../sync/clientDomains.js";
import { db } from "./index.js";

interface SafeParseIssue {
  path?: readonly (string | number)[];
  message: string;
}

export interface SafeParseSchema<T extends object> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly SafeParseIssue[] } };
}

export interface NormalizationWrite<T = unknown> {
  key: string;
  value: T;
}

export interface NormalizationSkip {
  key: string;
  issues: string[];
}

export interface NormalizationPlan<T = unknown> {
  writes: NormalizationWrite<T>[];
  skipped: NormalizationSkip[];
}

/** 递归结构相等：对象键顺序无关，数组保序。用于判断归一前后是否真有变化。 */
export function isDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => isDeepEqual(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (!isDeepEqual(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) => isDeepEqual(left[key], right[key]));
}

/**
 * 把一批存量 doc 向 schema 归一：schema 补默认 + 剥孤儿。
 * 纯函数：成功且相对原始有变化的进 writes；解析失败的进 skipped（保留不动）。
 */
export function planNormalization<T extends object>(
  rawDocs: unknown[],
  schema: SafeParseSchema<T>,
  keyOf: (doc: Record<string, unknown>) => string,
): NormalizationPlan<T> {
  const writes: NormalizationWrite<T>[] = [];
  const skipped: NormalizationSkip[] = [];

  for (const raw of rawDocs) {
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const key = keyOf(record);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      skipped.push({
        key,
        issues: parsed.error.issues.map((issue) => `${issue.path?.join(".") || "<root>"}: ${issue.message}`),
      });
      continue;
    }
    if (!isDeepEqual(raw, parsed.data)) writes.push({ key, value: parsed.data });
  }

  return { writes, skipped };
}

/** schema 有意义变更时 +1，触发下次启动重跑归一。 */
export const SCHEMA_NORMALIZATION_VERSION = 8; // 8: Task.sessionId（v16 upgrade 已补默认，此处双保险跟随 ruleId/skipped 先例）

/** 在一个跨全表 rw 事务内归一所有实体表（读写同事务，原子）。 */
export async function normalizeClientStores(): Promise<NormalizationPlan> {
  const domains = Object.values(CLIENT_SYNC_DOMAINS);
  const tables = domains.map((domain) => db.table(domain.storeName));
  const writes: NormalizationWrite[] = [];
  const skipped: NormalizationSkip[] = [];

  await db.transaction("rw", tables, async () => {
    for (const domain of domains) {
      const table = db.table(domain.storeName);
      const rawDocs = await table.toArray();
      const plan = planNormalization(
        rawDocs,
        domain.schema as SafeParseSchema<Record<string, unknown>>,
        (doc) => domain.keyOf ? domain.keyOf(doc) : String(doc.id ?? doc.key ?? "<missing-key>"),
      );
      if (plan.writes.length > 0) await table.bulkPut(plan.writes.map((write) => write.value));
      writes.push(...plan.writes);
      skipped.push(...plan.skipped.map((item) => ({ ...item, key: `${domain.table}:${item.key}` })));
    }
  });

  return { writes, skipped };
}

/**
 * 启动时按 schema 归一全部实体表。localStorage 版本闸保证每个版本只跑一次。
 * 纯本地卫生：保留 updatedAt、不写 syncLog。只有整轮成功才推进版本号；抛错不推进、下次重试。
 */
export async function runSchemaNormalizationIfNeeded(): Promise<void> {
  const saved = Number(safeGetItem(STORAGE_KEYS.schemaNormalizationVersion) ?? "0");
  if (Number.isFinite(saved) && saved >= SCHEMA_NORMALIZATION_VERSION) return;

  const plan = await normalizeClientStores();
  if (plan.skipped.length > 0) {
    console.warn("[schema-normalization] skipped invalid records:", plan.skipped);
  }
  safeSetItem(STORAGE_KEYS.schemaNormalizationVersion, String(SCHEMA_NORMALIZATION_VERSION));
}
