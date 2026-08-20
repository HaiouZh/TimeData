import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.js";

// 等外部信号：步骤带这些标签时，调度台把该轨道归入『等外部』分组（在等一个不是自己也不是 agent 的条件）。
// 显式 [] = 不归出该组；未配置 = 默认 等外部。
export const TRACK_WAIT_EXTERNAL_TAGS_KEY = "track.waitExternalTags.v1";
export const DEFAULT_WAIT_EXTERNAL_TAGS: readonly string[] = ["等外部"];

export function sanitizeWaitExternalTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [...DEFAULT_WAIT_EXTERNAL_TAGS];
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

export function parseWaitExternalTags(raw: string | null | undefined): string[] {
  if (raw == null) return [...DEFAULT_WAIT_EXTERNAL_TAGS];
  try {
    return sanitizeWaitExternalTags(JSON.parse(raw));
  } catch {
    return [...DEFAULT_WAIT_EXTERNAL_TAGS];
  }
}

export async function readWaitExternalTags(): Promise<string[]> {
  return parseWaitExternalTags(await getSetting(TRACK_WAIT_EXTERNAL_TAGS_KEY));
}

export function setWaitExternalTags(tags: readonly string[]): Promise<void> {
  return setSetting(TRACK_WAIT_EXTERNAL_TAGS_KEY, JSON.stringify(sanitizeWaitExternalTags([...tags])));
}

export function useWaitExternalTags(): string[] {
  const raw = useSetting(TRACK_WAIT_EXTERNAL_TAGS_KEY);
  return useMemo(() => parseWaitExternalTags(raw), [raw]);
}
