import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.js";

// 恢复推进信号：步骤带这些标签时视为显式宣告『恢复推进』——它是信号步、会覆盖旧信号，而在调度判定里不命中任何显式组、落回『推进中』。没有它信号是棘轮（打了等外部回不到推进中）。显式 [] = 关闭该出口；未配置 = 默认 推进中。
export const TRACK_RESUME_TAGS_KEY = "track.resumeTags.v1";
export const DEFAULT_RESUME_TAGS: readonly string[] = ["推进中"];

export function sanitizeResumeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [...DEFAULT_RESUME_TAGS];
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/^#/, "");
    if (!tag || tag.length > 64 || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

export function parseResumeTags(raw: string | null | undefined): string[] {
  if (raw == null) return [...DEFAULT_RESUME_TAGS];
  try {
    return sanitizeResumeTags(JSON.parse(raw));
  } catch {
    return [...DEFAULT_RESUME_TAGS];
  }
}

export async function readResumeTags(): Promise<string[]> {
  return parseResumeTags(await getSetting(TRACK_RESUME_TAGS_KEY));
}

export function setResumeTags(tags: readonly string[]): Promise<void> {
  return setSetting(TRACK_RESUME_TAGS_KEY, JSON.stringify(sanitizeResumeTags([...tags])));
}

export function useResumeTags(): string[] {
  const raw = useSetting(TRACK_RESUME_TAGS_KEY);
  return useMemo(() => parseResumeTags(raw), [raw]);
}
