import { useMemo } from "react";
import { defaultCourtForTrackTag, normalizeTrackCourt, type TrackCourt } from "../trackCourts.js";
import { getSetting, setSetting, useSetting } from "./index.js";

export const TRACK_ACTION_TAGS_KEY = "track.actionTags.v2";
export const LEGACY_TRACK_ACTION_TAGS_KEY = "track.actionTags.v1";

export interface TrackActionTagConfig {
  tag: string;
  court: TrackCourt;
}

export const DEFAULT_ACTION_TAG_CONFIGS: readonly TrackActionTagConfig[] = [
  { tag: "等我", court: "mine" },
  { tag: "待决策", court: "mine" },
  { tag: "卡住", court: "blocked" },
  { tag: "agent在做", court: "agent" },
];

export const DEFAULT_ACTION_TAGS: readonly string[] = DEFAULT_ACTION_TAG_CONFIGS.map((item) => item.tag);

const MAX_ACTION_TAGS = 50;
const MAX_ACTION_TAG_LENGTH = 64;

export function sanitizeActionTagConfigs(values: unknown): TrackActionTagConfig[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: TrackActionTagConfig[] = [];
  for (const value of values) {
    if (typeof value !== "object" || value === null) continue;
    const rawTag = (value as { tag?: unknown }).tag;
    if (typeof rawTag !== "string") continue;
    const trimmed = rawTag.trim();
    if (!trimmed || trimmed.length > MAX_ACTION_TAG_LENGTH || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push({ tag: trimmed, court: normalizeTrackCourt((value as { court?: unknown }).court) });
    if (result.length >= MAX_ACTION_TAGS) break;
  }
  return result;
}

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

function migrateLegacyTags(raw: string | null): TrackActionTagConfig[] {
  if (raw === null) return [];
  try {
    return sanitizeActionTags(JSON.parse(raw)).map((tag) => ({ tag, court: defaultCourtForTrackTag(tag) }));
  } catch {
    return [];
  }
}

function parseActionTagConfigs(rawV2: string | null, rawV1: string | null): TrackActionTagConfig[] {
  if (rawV2 !== null) {
    try {
      const parsed: unknown = JSON.parse(rawV2);
      if (!Array.isArray(parsed)) return [...DEFAULT_ACTION_TAG_CONFIGS];
      const sanitized = sanitizeActionTagConfigs(parsed);
      if (parsed.length > 0 && sanitized.length === 0) return [...DEFAULT_ACTION_TAG_CONFIGS];
      return sanitized;
    } catch {
      return [...DEFAULT_ACTION_TAG_CONFIGS];
    }
  }

  const migrated = migrateLegacyTags(rawV1);
  return migrated.length > 0 ? migrated : [...DEFAULT_ACTION_TAG_CONFIGS];
}

export function trackActionTagTexts(configs: readonly TrackActionTagConfig[]): string[] {
  return configs.map((item) => item.tag);
}

export function courtOfTrackTag(configs: readonly TrackActionTagConfig[], tag: string): TrackCourt | null {
  return configs.find((item) => item.tag === tag)?.court ?? null;
}

export async function readTrackActionTagConfigs(): Promise<TrackActionTagConfig[]> {
  const [rawV2, rawV1] = await Promise.all([getSetting(TRACK_ACTION_TAGS_KEY), getSetting(LEGACY_TRACK_ACTION_TAGS_KEY)]);
  return parseActionTagConfigs(rawV2, rawV1);
}

export async function readTrackActionTags(): Promise<string[]> {
  return trackActionTagTexts(await readTrackActionTagConfigs());
}

export function setTrackActionTagConfigs(configs: readonly TrackActionTagConfig[]): Promise<void> {
  return setSetting(TRACK_ACTION_TAGS_KEY, JSON.stringify(sanitizeActionTagConfigs([...configs])));
}

export function setTrackActionTags(tags: readonly string[]): Promise<void> {
  return setTrackActionTagConfigs(sanitizeActionTags([...tags]).map((tag) => ({ tag, court: defaultCourtForTrackTag(tag) })));
}

export function useTrackActionTagConfigs(): TrackActionTagConfig[] {
  const rawV2 = useSetting(TRACK_ACTION_TAGS_KEY);
  const rawV1 = useSetting(LEGACY_TRACK_ACTION_TAGS_KEY);
  return useMemo(() => parseActionTagConfigs(rawV2, rawV1), [rawV2, rawV1]);
}

export function useTrackActionTags(): string[] {
  const configs = useTrackActionTagConfigs();
  return useMemo(() => trackActionTagTexts(configs), [configs]);
}
