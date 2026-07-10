import type { Category, SyncChange, SyncPushOutcome, TimeEntry } from "@timedata/shared";
import { SYNC_DOMAINS, type SyncDomainConfig, UtcIsoStringSchema, getSyncDomain } from "@timedata/shared";
import type { Database } from "better-sqlite3";
import { type CategoryParentInfo, SERVER_SYNC_DOMAINS, changeOutcome } from "./domains.js";

export interface SyncValidationResult {
  valid: boolean;
  outcomes: SyncPushOutcome[];
}

interface SyncValidationOptions {
  now?: Date | string;
}

function nowUtcString(now: Date | string | undefined): string {
  if (typeof now === "string") return now;
  return (now || new Date()).toISOString();
}

function collectBatchCategories(changes: SyncChange[]): Map<string, CategoryParentInfo> {
  const categories = new Map<string, CategoryParentInfo>();
  for (const change of changes) {
    if (change.tableName !== "categories" || change.action === "delete" || !change.data) continue;
    const data = change.data as Category;
    categories.set(data.id, { id: data.id, parentId: data.parentId, isArchived: data.isArchived });
  }
  return categories;
}

// 域无关的通用校验：delete 直接接受；upsert 要求 payload 存在、过域 schema、主键与 recordId 一致。
function validateGenericChange(
  change: SyncChange,
  domain: SyncDomainConfig,
  identity: ((data: unknown) => string) | undefined,
  idField: string,
): SyncPushOutcome | null {
  if (change.action === "delete") return null;
  // 静态类型上 upsert 的 data 非空，但运行时入参可能缺失（schema 之前的形状兜底）。
  const tableName = change.tableName;
  if (!change.data) {
    return changeOutcome(change, "rejected", "missing_payload", `${tableName} create/update requires payload`);
  }

  const parsed = domain.dataSchema.safeParse(change.data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const detail = issue ? ` (${issue.path.join(".")}: ${issue.message})` : "";
    return changeOutcome(
      change,
      "rejected",
      shapeReasonCode(change, issue?.path ?? []),
      `${change.tableName} payload is invalid${detail}`,
    );
  }

  const payloadId = identity ? identity(parsed.data) : (parsed.data as Record<string, unknown>)[idField];
  if (payloadId !== change.recordId) {
    return changeOutcome(change, "rejected", "id_mismatch", `${change.tableName} payload ${idField} does not match recordId`);
  }

  return null;
}

// entry 的时间范围错误历史上用 invalid_time_range 原因码，schema refine 命中 endTime 时映射回去，保持错误码兼容。
function shapeReasonCode(change: SyncChange, issuePath: ReadonlyArray<PropertyKey>): SyncPushOutcome["reasonCode"] {
  if (change.tableName === "time_entries" && issuePath[0] === "endTime") {
    const data = change.data as TimeEntry;
    if (
      UtcIsoStringSchema.safeParse(data.startTime).success &&
      UtcIsoStringSchema.safeParse(data.endTime).success &&
      data.endTime <= data.startTime
    ) {
      return "invalid_time_range";
    }
  }
  return "invalid_shape";
}

// registry 参数仅测试注入用，生产代码用默认登记簿。
export function validateSyncChanges(
  db: Database,
  changes: SyncChange[],
  options: SyncValidationOptions = {},
  registry: readonly SyncDomainConfig[] = SYNC_DOMAINS,
): SyncValidationResult {
  const ctx = {
    batchCategories: collectBatchCategories(changes),
    now: nowUtcString(options.now),
  };
  const previousChanges: SyncChange[] = [];
  const outcomes = changes.map((change) => {
    let result: SyncPushOutcome;
    const hooks = SERVER_SYNC_DOMAINS[change.tableName];
    if (!change.recordId || !change.timestamp || !["create", "update", "delete"].includes(change.action)) {
      result = changeOutcome(change, "rejected", "invalid_shape", "sync change shape is invalid");
    } else if (!hooks) {
      result = changeOutcome(change, "rejected", "invalid_shape", "sync tableName is invalid");
    } else {
      const domain = getSyncDomain(change.tableName, registry);
      const idField = hooks.lww?.idColumn ?? "id";
      result =
        hooks.crossValidate?.(change, previousChanges) ??
        validateGenericChange(change, domain, hooks.identity, idField) ??
        hooks.validate?.(db, change, ctx) ??
        changeOutcome(change, "accepted", "applied", `${change.tableName} change passed validation`);
    }

    if (result.status === "accepted") previousChanges.push(change);
    return result;
  });

  return {
    valid: outcomes.every((item) => item.status === "accepted"),
    outcomes,
  };
}
