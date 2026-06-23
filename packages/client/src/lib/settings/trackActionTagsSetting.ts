import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.js";

export const TRACK_ACTION_TAGS_KEY = "track.actionTags.v2";
export const LEGACY_TRACK_ACTION_TAGS_KEY = "track.actionTags.v1";

export const DEFAULT_ACTION_TAGS: readonly string[] = ["待我处理", "agent在做"];

const OLD_DEFAULT_ACTION_TAGS = ["等我", "待决策", "卡住", "agent在做"];
const MAX_ACTION_TAGS = 50;
const MAX_ACTION_TAG_LENGTH = 64;

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function tagTextFromUnknown(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && typeof (value as { tag?: unknown }).tag === "string") {
    return (value as { tag: string }).tag;
  }
  return null;
}

export function sanitizeActionTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const raw = tagTextFromUnknown(value);
    if (raw === null) continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_ACTION_TAG_LENGTH || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= MAX_ACTION_TAGS) break;
  }
  return result;
}

function parseActionTags(rawV2: string | null, rawV1: string | null): string[] {
  if (rawV2 !== null) {
    try {
      const parsed: unknown = JSON.parse(rawV2);
      if (!Array.isArray(parsed)) return [...DEFAULT_ACTION_TAGS];
      const sanitized = sanitizeActionTags(parsed);
      if (sameTags(sanitized, OLD_DEFAULT_ACTION_TAGS)) return [...DEFAULT_ACTION_TAGS];
      if (parsed.length > 0 && sanitized.length === 0) return [...DEFAULT_ACTION_TAGS];
      return sanitized;
    } catch {
      return [...DEFAULT_ACTION_TAGS];
    }
  }

  if (rawV1 !== null) {
    try {
      const sanitized = sanitizeActionTags(JSON.parse(rawV1));
      return sameTags(sanitized, OLD_DEFAULT_ACTION_TAGS) ? [...DEFAULT_ACTION_TAGS] : sanitized;
    } catch {
      return [...DEFAULT_ACTION_TAGS];
    }
  }

  return [...DEFAULT_ACTION_TAGS];
}

export async function readTrackActionTags(): Promise<string[]> {
  const [rawV2, rawV1] = await Promise.all([getSetting(TRACK_ACTION_TAGS_KEY), getSetting(LEGACY_TRACK_ACTION_TAGS_KEY)]);
  return parseActionTags(rawV2, rawV1);
}

export function setTrackActionTags(tags: readonly string[]): Promise<void> {
  return setSetting(TRACK_ACTION_TAGS_KEY, JSON.stringify(sanitizeActionTags([...tags])));
}

export function useTrackActionTags(): string[] {
  const rawV2 = useSetting(TRACK_ACTION_TAGS_KEY);
  const rawV1 = useSetting(LEGACY_TRACK_ACTION_TAGS_KEY);
  return useMemo(() => parseActionTags(rawV2, rawV1), [rawV2, rawV1]);
}
