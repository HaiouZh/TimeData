import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "../settings/index.ts";
import type { GravitySurfacedMap } from "./gravity.ts";

export const TODO_GRAVITY_REVIEW_SETTING_KEY = "todo.gravity.review.v1";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function sanitizeGravitySurfacedMap(value: unknown): GravitySurfacedMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[0] === "string" && isIsoString(entry[1]),
    ),
  );
}

export function parseGravitySurfacedMap(raw: string | null): GravitySurfacedMap {
  if (!raw) return {};
  try {
    return sanitizeGravitySurfacedMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function readGravitySurfacedMap(): Promise<GravitySurfacedMap> {
  return parseGravitySurfacedMap(await getSetting(TODO_GRAVITY_REVIEW_SETTING_KEY));
}

export function useGravitySurfacedMap(): GravitySurfacedMap {
  const raw = useSetting(TODO_GRAVITY_REVIEW_SETTING_KEY);
  return useMemo(() => parseGravitySurfacedMap(raw), [raw]);
}

interface MarkOptions {
  /** 水线天数，用于计算 prune horizon = max(90, waterlineDays * 4)。 */
  waterlineDays?: number;
}

export async function markGravityTasksSurfaced(
  taskIds: readonly string[],
  now: Date = new Date(),
  options: MarkOptions = {},
): Promise<GravitySurfacedMap> {
  if (taskIds.length === 0) return readGravitySurfacedMap();

  const existing = await readGravitySurfacedMap();
  const iso = now.toISOString();
  const merged: GravitySurfacedMap = { ...existing };
  for (const id of taskIds) {
    const prev = merged[id];
    // UTC ISO 字典序 == 时间序，直接取较大值。
    merged[id] = prev && prev > iso ? prev : iso;
  }

  const horizonDays = Math.max(90, (options.waterlineDays ?? 14) * 4);
  const cutoff = now.getTime() - horizonDays * MS_PER_DAY;
  const pruned: GravitySurfacedMap = {};
  for (const [id, ts] of Object.entries(merged)) {
    if (new Date(ts).getTime() >= cutoff) pruned[id] = ts;
  }

  await setSetting(TODO_GRAVITY_REVIEW_SETTING_KEY, JSON.stringify(pruned));
  return pruned;
}