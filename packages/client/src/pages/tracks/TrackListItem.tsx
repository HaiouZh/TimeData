import type { Track, TrackStep } from "@timedata/shared";
import { Link } from "react-router-dom";
import { latestStepsForCard, stepSourceText, trackProgressSummary } from "../../lib/tracksView.js";

const STATUS_DOT: Record<string, string> = { active: "bg-accent", concluded: "bg-ink-3", parked: "bg-ink-3" };

export function TrackListItem({ track, steps, now = new Date() }: { track: Track; steps: TrackStep[]; now?: Date }) {
  const latestSteps = track.status === "active" ? latestStepsForCard(steps) : [];
  return (
    <Link
      to={`/tracks/${track.id}`}
      className="block rounded-card border border-border bg-surface px-3 py-3 transition hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent"
    >
      <span className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-pill ${STATUS_DOT[track.status] ?? "bg-ink-3"}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{track.title}</span>
          {track.summary && <span className="mt-0.5 block truncate text-xs text-ink-2">{track.summary}</span>}
          <span className="mt-0.5 block truncate text-xs text-ink-3">{trackProgressSummary(steps, now)}</span>
        </span>
      </span>
      {latestSteps.length > 0 && (
        <span className="mt-2 block space-y-1 border-t border-border pt-2">
          {latestSteps.map((step) => (
            <span key={step.id} className="block truncate text-xs leading-5 text-ink-2">
              <span data-source={step.source} className="mr-1 rounded-pill bg-surface-elevated px-1.5 py-0.5 text-ink-3">
                {stepSourceText(step)}
              </span>
              {step.tags.map((tag) => (
                <span key={tag} className="mr-1 text-accent">
                  #{tag}
                </span>
              ))}
              {step.content || "无内容步骤"}
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}
