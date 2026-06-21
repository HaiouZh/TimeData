import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.js";

export const TRACK_ACTION_TAGS_KEY = "track.actionTags.v1";
// 未配置时的种子默认;不是锁死枚举,用户可在设置页自由增删(spec §3.1 不写死)。
export const DEFAULT_ACTION_TAGS: readonly string[] = ["等我", "待决策", "卡住"];

// 防脏数据上限(并入 codex 版健壮性):超长 tag 丢弃、最多保留 50 个。
const MAX_ACTION_TAGS = 50;
const MAX_ACTION_TAG_LENGTH = 64;

export function sanitizeActionTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_ACTION_TAG_LENGTH || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= MAX_ACTION_TAGS) break;
  }
  return result;
}

// key 从未配置(null)/坏 JSON/非数组 → 种子;非空数组但清洗后全空(全是脏值)→ 种子;
// 用户显式存 "[]" → 尊重空数组(照 navVisibleTabsSetting 的 null-vs-空 惯例)。
function parseActionTags(raw: string | null): string[] {
  if (raw === null) return [...DEFAULT_ACTION_TAGS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_ACTION_TAGS];
    const sanitized = sanitizeActionTags(parsed);
    if (parsed.length > 0 && sanitized.length === 0) return [...DEFAULT_ACTION_TAGS];
    return sanitized;
  } catch {
    return [...DEFAULT_ACTION_TAGS];
  }
}

export async function readTrackActionTags(): Promise<string[]> {
  return parseActionTags(await getSetting(TRACK_ACTION_TAGS_KEY));
}

export function setTrackActionTags(tags: readonly string[]): Promise<void> {
  return setSetting(TRACK_ACTION_TAGS_KEY, JSON.stringify(sanitizeActionTags([...tags])));
}

export function useTrackActionTags(): string[] {
  const raw = useSetting(TRACK_ACTION_TAGS_KEY);
  return useMemo(() => parseActionTags(raw), [raw]);
}
