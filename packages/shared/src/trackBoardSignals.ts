import type { TrackStep } from "./types.js";

export const TRACK_ACTION_TAGS_KEY = "track.actionTags.v2";
export const LEGACY_TRACK_ACTION_TAGS_KEY = "track.actionTags.v1";
export const DEFAULT_TRACK_BOARD_SIGNALS: readonly string[] = ["待我处理", "agent在做"];

const OLD_DEFAULT_TRACK_BOARD_SIGNALS = ["等我", "待决策", "卡住", "agent在做"];
const MAX_TRACK_BOARD_SIGNALS = 50;
const MAX_TRACK_BOARD_SIGNAL_LENGTH = 64;

export interface TrackBoardSignal {
  tag: string;
  stepId: string;
}

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

export function uniqueTrackBoardSignals(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function sanitizeTrackBoardSignals(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const raw = tagTextFromUnknown(value);
    if (raw === null) continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_TRACK_BOARD_SIGNAL_LENGTH || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= MAX_TRACK_BOARD_SIGNALS) break;
  }
  return result;
}

export function parseTrackBoardSignalsFromSettings(rawV2: string | null, rawV1: string | null): string[] {
  if (rawV2 !== null) {
    try {
      const parsed: unknown = JSON.parse(rawV2);
      if (!Array.isArray(parsed)) return [...DEFAULT_TRACK_BOARD_SIGNALS];
      const sanitized = sanitizeTrackBoardSignals(parsed);
      if (sameTags(sanitized, OLD_DEFAULT_TRACK_BOARD_SIGNALS)) return [...DEFAULT_TRACK_BOARD_SIGNALS];
      if (parsed.length > 0 && sanitized.length === 0) return [...DEFAULT_TRACK_BOARD_SIGNALS];
      return sanitized;
    } catch {
      return [...DEFAULT_TRACK_BOARD_SIGNALS];
    }
  }

  if (rawV1 !== null) {
    try {
      const sanitized = sanitizeTrackBoardSignals(JSON.parse(rawV1));
      return sameTags(sanitized, OLD_DEFAULT_TRACK_BOARD_SIGNALS) ? [...DEFAULT_TRACK_BOARD_SIGNALS] : sanitized;
    } catch {
      return [...DEFAULT_TRACK_BOARD_SIGNALS];
    }
  }

  return [...DEFAULT_TRACK_BOARD_SIGNALS];
}

function byTrackStepOrderAsc(a: TrackStep, b: TrackStep): number {
  return a.seq - b.seq || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id);
}

function byTrackStepOrderDesc(a: TrackStep, b: TrackStep): number {
  return -byTrackStepOrderAsc(a, b);
}

export function latestTrackBoardSignal(
  steps: readonly TrackStep[],
  boardSignals: readonly string[],
): TrackBoardSignal | null {
  const normalizedSignals = uniqueTrackBoardSignals(boardSignals);
  if (normalizedSignals.length === 0) return null;
  for (const step of [...steps].sort(byTrackStepOrderDesc)) {
    const stepTags = new Set(uniqueTrackBoardSignals(step.tags));
    for (const tag of normalizedSignals) {
      if (stepTags.has(tag)) return { tag, stepId: step.id };
    }
  }
  return null;
}
