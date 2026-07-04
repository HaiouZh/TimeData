import type { QuickNote } from "@timedata/shared";
import { localDateTimeToUtc, utcToLocalDateTime } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listQuickNotesFrom,
  listQuickNotesLatest,
  listQuickNotesNewerThan,
  listQuickNotesOlderThan,
  listQuickNotesWindow,
} from "../lib/quickNotes.js";

export const QUICK_NOTE_PAGE_SIZE = 50;

interface WindowState {
  oldestUtc: string;
  newestUtc: string | null;
}

export interface QuickNoteTimeline {
  notes: QuickNote[];
  loading: boolean;
  hasOlder: boolean;
  atLatest: boolean;
  loadOlder: () => Promise<void>;
  loadNewer: () => Promise<void>;
  jumpToDate: (localDate: string) => Promise<void>;
  jumpToNote: (note: { occurredAt: string }) => Promise<void>;
  resetToLatest: () => Promise<void>;
}

async function hasNotesOlderThan(utc: string): Promise<boolean> {
  return (await listQuickNotesOlderThan(utc, 1)).length > 0;
}

async function hasNotesNewerThan(utc: string): Promise<boolean> {
  return (await listQuickNotesNewerThan(utc, 1)).length > 0;
}

export function useQuickNoteTimeline(
  pageSize: number = QUICK_NOTE_PAGE_SIZE,
  anchorLocalDate: string | null = null,
): QuickNoteTimeline {
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const requestSeqRef = useRef(0);

  const resetToLatest = useCallback(async () => {
    const requestSeq = ++requestSeqRef.current;
    const latest = await listQuickNotesLatest(pageSize);
    const oldestUtc = latest[0]?.occurredAt ?? new Date().toISOString();
    const nextHasOlder = latest.length === pageSize && (await hasNotesOlderThan(oldestUtc));
    if (requestSeq !== requestSeqRef.current) return;
    setWindowState({ oldestUtc, newestUtc: null });
    setHasOlder(nextHasOlder);
  }, [pageSize]);

  const notes =
    useLiveQuery(
      () =>
        windowState ? listQuickNotesWindow(windowState.oldestUtc, windowState.newestUtc) : Promise.resolve([]),
      [windowState?.oldestUtc, windowState?.newestUtc],
    ) ?? [];

  const loadOlder = useCallback(async () => {
    if (!windowState || !hasOlder) return;
    const requestSeq = requestSeqRef.current;
    const batch = await listQuickNotesOlderThan(windowState.oldestUtc, pageSize);
    if (requestSeq !== requestSeqRef.current) return;
    if (batch.length === 0) {
      setHasOlder(false);
      return;
    }

    const oldestUtc = batch[0].occurredAt;
    setWindowState((prev) => (prev ? { ...prev, oldestUtc } : prev));
    const nextHasOlder = batch.length === pageSize && (await hasNotesOlderThan(oldestUtc));
    if (requestSeq !== requestSeqRef.current) return;
    setHasOlder(nextHasOlder);
  }, [windowState, hasOlder, pageSize]);

  const loadNewer = useCallback(async () => {
    if (!windowState || windowState.newestUtc === null) return;
    const requestSeq = requestSeqRef.current;
    const batch = await listQuickNotesNewerThan(windowState.newestUtc, pageSize + 1);
    if (requestSeq !== requestSeqRef.current) return;
    const visibleBatch = batch.slice(0, pageSize);
    if (visibleBatch.length === 0) {
      setWindowState((prev) => (prev ? { ...prev, newestUtc: null } : prev));
      return;
    }

    const newestUtc = visibleBatch[visibleBatch.length - 1].occurredAt;
    setWindowState((prev) => (prev ? { ...prev, newestUtc: batch.length <= pageSize ? null : newestUtc } : prev));
  }, [windowState, pageSize]);

  const jumpToDate = useCallback(
    async (localDate: string) => {
      const requestSeq = ++requestSeqRef.current;
      const oldestUtc = localDateTimeToUtc(`${localDate}T00:00:00`);
      const batch = await listQuickNotesFrom(oldestUtc, pageSize);
      const newestUtc =
        batch.length < pageSize || !(await hasNotesNewerThan(batch[batch.length - 1].occurredAt))
          ? null
          : batch[batch.length - 1].occurredAt;
      const nextHasOlder = await hasNotesOlderThan(oldestUtc);
      if (requestSeq !== requestSeqRef.current) return;
      setWindowState({ oldestUtc, newestUtc });
      setHasOlder(nextHasOlder);
    },
    [pageSize],
  );

  const jumpToNote = useCallback(
    async (note: { occurredAt: string }) => {
      const requestSeq = ++requestSeqRef.current;
      const localDate = utcToLocalDateTime(note.occurredAt).slice(0, 10);
      const oldestUtc = localDateTimeToUtc(`${localDate}T00:00:00`);
      const batch = await listQuickNotesFrom(oldestUtc, pageSize);
      const tailUtc = batch.length > 0 ? batch[batch.length - 1].occurredAt : note.occurredAt;
      // 从当天 00:00 固定取一窗时，目标可能在窗外；窗口上界至少扩到目标。
      const coverUtc = tailUtc >= note.occurredAt ? tailUtc : note.occurredAt;
      const newestUtc = (await hasNotesNewerThan(coverUtc)) ? coverUtc : null;
      const nextHasOlder = await hasNotesOlderThan(oldestUtc);
      if (requestSeq !== requestSeqRef.current) return;
      setWindowState({ oldestUtc, newestUtc });
      setHasOlder(nextHasOlder);
    },
    [pageSize],
  );

  useEffect(() => {
    let cancelled = false;
    const requestSeq = ++requestSeqRef.current;
    void (async () => {
      if (anchorLocalDate) {
        const oldestUtc = localDateTimeToUtc(`${anchorLocalDate}T00:00:00`);
        const batch = await listQuickNotesFrom(oldestUtc, pageSize);
        const newestUtc =
          batch.length < pageSize || !(await hasNotesNewerThan(batch[batch.length - 1].occurredAt))
            ? null
            : batch[batch.length - 1].occurredAt;
        const nextHasOlder = await hasNotesOlderThan(oldestUtc);
        if (cancelled || requestSeq !== requestSeqRef.current) return;
        setWindowState({ oldestUtc, newestUtc });
        setHasOlder(nextHasOlder);
        return;
      }

      const latest = await listQuickNotesLatest(pageSize);
      const oldestUtc = latest[0]?.occurredAt ?? new Date().toISOString();
      const nextHasOlder = latest.length === pageSize && (await hasNotesOlderThan(oldestUtc));
      if (cancelled || requestSeq !== requestSeqRef.current) return;
      setWindowState({ oldestUtc, newestUtc: null });
      setHasOlder(nextHasOlder);
    })();
    return () => {
      cancelled = true;
    };
  }, [pageSize, anchorLocalDate]);

  return {
    notes,
    loading: windowState === null,
    hasOlder,
    atLatest: windowState?.newestUtc === null,
    loadOlder,
    loadNewer,
    jumpToDate,
    jumpToNote,
    resetToLatest,
  };
}
