import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.js";

// 甘特执行者信号：步骤带这些标签时，甘特按 agent 执行者着色（无论谁写入这一步）。
// 显式 [] = 不按信号判执行者、只看写入者；未配置 = 默认 agent在做。
export const TRACK_AGENT_EXEC_TAGS_KEY = "track.agentExecTags.v1";
export const DEFAULT_AGENT_EXEC_TAGS: readonly string[] = ["agent在做"];

export function sanitizeAgentExecTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [...DEFAULT_AGENT_EXEC_TAGS];
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

export function parseAgentExecTags(raw: string | null | undefined): string[] {
  if (raw == null) return [...DEFAULT_AGENT_EXEC_TAGS];
  try {
    return sanitizeAgentExecTags(JSON.parse(raw));
  } catch {
    return [...DEFAULT_AGENT_EXEC_TAGS];
  }
}

export async function readAgentExecTags(): Promise<string[]> {
  return parseAgentExecTags(await getSetting(TRACK_AGENT_EXEC_TAGS_KEY));
}

export function setAgentExecTags(tags: readonly string[]): Promise<void> {
  return setSetting(TRACK_AGENT_EXEC_TAGS_KEY, JSON.stringify(sanitizeAgentExecTags([...tags])));
}

export function useAgentExecTags(): string[] {
  const raw = useSetting(TRACK_AGENT_EXEC_TAGS_KEY);
  return useMemo(() => parseAgentExecTags(raw), [raw]);
}
