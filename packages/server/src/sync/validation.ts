import type { Database } from "better-sqlite3";
import type { Category, SyncChange, SyncPushOutcome, TimeEntry } from "@timedata/shared";
import { UtcIsoStringSchema } from "@timedata/shared";

export interface SyncValidationResult {
  valid: boolean;
  outcomes: SyncPushOutcome[];
}

interface SyncValidationOptions {
  now?: Date | string;
}

interface CategoryParentInfo {
  id: string;
  parentId: string | null;
  isArchived: boolean;
}

function outcome(
  change: SyncChange,
  status: SyncPushOutcome["status"],
  reasonCode: SyncPushOutcome["reasonCode"],
  message: string,
  serverUpdatedAt?: string,
): SyncPushOutcome {
  return {
    tableName: change.tableName,
    recordId: change.recordId,
    action: change.action,
    status,
    reasonCode,
    message,
    incomingTimestamp: change.timestamp,
    serverUpdatedAt,
  };
}

function isIsoLike(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
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

function getCategoryParentInfo(db: Database, batchCategories: Map<string, CategoryParentInfo>, id: string): CategoryParentInfo | null {
  const batch = batchCategories.get(id);
  if (batch) return batch;

  const row = db.prepare("SELECT id, parent_id, is_archived FROM categories WHERE id = ?").get(id) as
    | { id: string; parent_id: string | null; is_archived: number }
    | undefined;
  return row ? { id: row.id, parentId: row.parent_id, isArchived: Boolean(row.is_archived) } : null;
}

function validateCategoryShape(change: SyncChange, data: Category): SyncPushOutcome | null {
  if (data.id !== change.recordId) return outcome(change, "rejected", "id_mismatch", "category payload id does not match recordId");
  if (typeof data.name !== "string" || !data.name.trim()) return outcome(change, "rejected", "invalid_shape", "category name is required");
  if (typeof data.color !== "string" || !data.color.trim()) return outcome(change, "rejected", "invalid_shape", "category color is required");
  if (typeof data.sortOrder !== "number" || typeof data.isArchived !== "boolean") return outcome(change, "rejected", "invalid_shape", "category flags are invalid");
  if (!isIsoLike(data.createdAt) || !isIsoLike(data.updatedAt)) return outcome(change, "rejected", "invalid_shape", "category timestamps are invalid");
  return null;
}

function validateEntryShape(change: SyncChange, data: TimeEntry, options: SyncValidationOptions): SyncPushOutcome | null {
  if (data.id !== change.recordId) return outcome(change, "rejected", "id_mismatch", "entry payload id does not match recordId");
  if (!isIsoLike(data.createdAt) || !isIsoLike(data.updatedAt)) {
    return outcome(change, "rejected", "invalid_shape", "entry timestamps are invalid");
  }
  if (!UtcIsoStringSchema.safeParse(data.startTime).success || !UtcIsoStringSchema.safeParse(data.endTime).success) {
    return outcome(change, "rejected", "invalid_shape", "entry startTime/endTime must be UTC ISO format (ending with Z)");
  }
  if (data.endTime <= data.startTime) return outcome(change, "rejected", "invalid_time_range", "entry endTime must be after startTime");
  if (data.endTime > nowUtcString(options.now)) return outcome(change, "rejected", "invalid_time_range", "entry endTime cannot be in the future");
  return null;
}

function validateCategoryChange(db: Database, batchCategories: Map<string, CategoryParentInfo>, change: SyncChange): SyncPushOutcome {
  if (change.action !== "delete" && !change.data) return outcome(change, "rejected", "missing_payload", "category create/update requires payload");

  if (change.action === "delete") return outcome(change, "accepted", "applied", "category delete can be applied");

  const data = change.data as Category;
  const shapeError = validateCategoryShape(change, data);
  if (shapeError) return shapeError;

  if (data.parentId === data.id) {
    return outcome(change, "rejected", "invalid_shape", "category cannot reference itself");
  }

  if (data.parentId) {
    const parent = getCategoryParentInfo(db, batchCategories, data.parentId);
    if (!parent) return outcome(change, "rejected", "missing_category", "parent category does not exist");
    if (parent.parentId !== null) return outcome(change, "rejected", "invalid_shape", "categories support only two levels");
  }

  return outcome(change, "accepted", "applied", "category change can be applied");
}

function validateEntryChange(db: Database, batchCategories: Map<string, CategoryParentInfo>, change: SyncChange, options: SyncValidationOptions): SyncPushOutcome {
  if (change.action !== "delete" && !change.data) return outcome(change, "rejected", "missing_payload", "entry create/update requires payload");

  if (change.action === "delete") return outcome(change, "accepted", "applied", "entry delete can be applied");

  const data = change.data as TimeEntry;
  const shapeError = validateEntryShape(change, data, options);
  if (shapeError) return shapeError;

  const category = getCategoryParentInfo(db, batchCategories, data.categoryId);
  if (!category) return outcome(change, "rejected", "missing_category", "entry category does not exist");
  if (category.isArchived) return outcome(change, "rejected", "archived_category", "entry category is archived");

  return outcome(change, "accepted", "applied", "entry change can be applied");
}

function incomingEntryOverlap(change: SyncChange, previousChanges: SyncChange[]): SyncPushOutcome | null {
  if (change.tableName !== "time_entries" || change.action === "delete" || !change.data) return null;
  const data = change.data as TimeEntry;

  for (const previous of previousChanges) {
    if (previous.tableName !== "time_entries" || previous.action === "delete" || !previous.data) continue;
    const previousData = previous.data as TimeEntry;
    if (previous.recordId === change.recordId) continue;
    if (previousData.startTime < data.endTime && previousData.endTime > data.startTime) {
      return outcome(change, "conflict", "overlap", `incoming entry overlaps another incoming entry ${previous.recordId}`);
    }
  }

  return null;
}

export function validateSyncChanges(db: Database, changes: SyncChange[], options: SyncValidationOptions = {}): SyncValidationResult {
  const batchCategories = collectBatchCategories(changes);
  const previousChanges: SyncChange[] = [];
  const outcomes = changes.map((change) => {
    let result: SyncPushOutcome;
    if (!change.recordId || !change.timestamp || !["create", "update", "delete"].includes(change.action)) {
      result = outcome(change, "rejected", "invalid_shape", "sync change shape is invalid");
    } else if (change.tableName === "categories") {
      result = validateCategoryChange(db, batchCategories, change);
    } else if (change.tableName === "time_entries") {
      result = incomingEntryOverlap(change, previousChanges) ?? validateEntryChange(db, batchCategories, change, options);
    } else {
      result = outcome(change, "rejected", "invalid_shape", "sync tableName is invalid");
    }

    if (result.status === "accepted") previousChanges.push(change);
    return result;
  });

  return {
    valid: outcomes.every((item) => item.status === "accepted"),
    outcomes,
  };
}

