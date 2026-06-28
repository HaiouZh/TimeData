import { safeGetItem, safeSetItem } from "../safeStorage.ts";
import { STORAGE_KEYS } from "../storageKeys.ts";
import type { GravitySurfacedMap } from "./gravity.ts";

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function readGravitySurfacedMap(): GravitySurfacedMap {
  const raw = safeGetItem(STORAGE_KEYS.todoGravityLastSurfaced);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[0] === "string" && isIsoString(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function writeGravitySurfacedMap(map: GravitySurfacedMap): void {
  safeSetItem(STORAGE_KEYS.todoGravityLastSurfaced, JSON.stringify(map));
}

export function markGravityTasksSurfaced(taskIds: readonly string[], now: Date = new Date()): GravitySurfacedMap {
  const next = { ...readGravitySurfacedMap() };
  const iso = now.toISOString();
  for (const id of taskIds) next[id] = iso;
  writeGravitySurfacedMap(next);
  return next;
}