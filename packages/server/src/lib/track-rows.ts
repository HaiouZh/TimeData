import type { Track, TrackStep } from "@timedata/shared";

export interface TrackRow {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  refs: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackStepRow {
  id: string;
  track_id: string;
  source: string;
  source_label: string | null;
  content: string;
  started_at: string;
  ended_at: string | null;
  refs: string | null;
  tags: string | null;
  seq: number;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
}

export function trackToRow(data: Track): Record<string, string | number | null> {
  return {
    id: data.id,
    title: data.title,
    summary: data.summary ?? null,
    status: data.status,
    refs: JSON.stringify(data.refs ?? []),
    created_at: data.createdAt,
  };
}

export function rowToTrack(row: TrackRow): Track {
  return {
    id: row.id,
    title: row.title,
    ...(row.summary !== null ? { summary: row.summary } : {}),
    status: row.status as Track["status"],
    refs: row.refs ? JSON.parse(row.refs) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function trackStepToRow(data: TrackStep): Record<string, string | number | null> {
  return {
    id: data.id,
    track_id: data.trackId,
    source: data.source,
    source_label: data.sourceLabel ?? null,
    content: data.content,
    started_at: data.startedAt,
    ended_at: data.endedAt,
    refs: JSON.stringify(data.refs ?? []),
    tags: JSON.stringify(data.tags ?? []),
    seq: data.seq,
    created_at: data.createdAt,
    edited_at: data.editedAt ?? null,
  };
}

export function rowToTrackStep(row: TrackStepRow): TrackStep {
  return {
    id: row.id,
    trackId: row.track_id,
    source: row.source as TrackStep["source"],
    ...(row.source_label !== null ? { sourceLabel: row.source_label } : {}),
    content: row.content,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    refs: row.refs ? JSON.parse(row.refs) : [],
    tags: row.tags ? JSON.parse(row.tags) : [],
    seq: row.seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.edited_at !== null ? { editedAt: row.edited_at } : {}),
  };
}
