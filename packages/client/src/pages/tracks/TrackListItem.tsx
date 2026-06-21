import type { Track, TrackStep } from "@timedata/shared";
import { Link } from "react-router-dom";
import { trackProgressSummary } from "../../lib/tracksView.js";

const STATUS_DOT: Record<string, string> = { active: "bg-accent", concluded: "bg-ink-3", parked: "bg-ink-3" };

export function TrackListItem({ track, steps, now = new Date() }: { track: Track; steps: TrackStep[]; now?: Date }) {
  return (
    <Link
      to={`/tracks/${track.id}`}
      className="flex items-center gap-3 rounded-card border border-border bg-surface px-3 py-2 transition hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent"
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-pill ${STATUS_DOT[track.status] ?? "bg-ink-3"}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{track.title}</span>
        <span className="block truncate text-xs text-ink-3">{trackProgressSummary(steps, now)}</span>
      </span>
    </Link>
  );
}
