import {
  DEFAULT_TRACK_BOARD_SIGNALS,
  LEGACY_TRACK_ACTION_TAGS_KEY,
  TRACK_ACTION_TAGS_KEY,
  parseTrackBoardSignalsFromSettings,
  sanitizeTrackBoardSignals,
} from "@timedata/shared";
import { useMemo } from "react";
import { getSetting, setSetting, useSetting } from "./index.js";

export { LEGACY_TRACK_ACTION_TAGS_KEY, TRACK_ACTION_TAGS_KEY };
export const DEFAULT_ACTION_TAGS: readonly string[] = DEFAULT_TRACK_BOARD_SIGNALS;
export const sanitizeActionTags = sanitizeTrackBoardSignals;

export async function readTrackActionTags(): Promise<string[]> {
  const [rawV2, rawV1] = await Promise.all([getSetting(TRACK_ACTION_TAGS_KEY), getSetting(LEGACY_TRACK_ACTION_TAGS_KEY)]);
  return parseTrackBoardSignalsFromSettings(rawV2, rawV1);
}

export function setTrackActionTags(tags: readonly string[]): Promise<void> {
  return setSetting(TRACK_ACTION_TAGS_KEY, JSON.stringify(sanitizeTrackBoardSignals([...tags])));
}

export function useTrackActionTags(): string[] {
  const rawV2 = useSetting(TRACK_ACTION_TAGS_KEY);
  const rawV1 = useSetting(LEGACY_TRACK_ACTION_TAGS_KEY);
  return useMemo(() => parseTrackBoardSignalsFromSettings(rawV2, rawV1), [rawV2, rawV1]);
}
