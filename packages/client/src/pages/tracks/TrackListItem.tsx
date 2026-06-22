import type { Track, TrackStep } from "@timedata/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TRACK_COURT_META } from "../../lib/trackCourts.js";
import {
  latestStepsForCard,
  stepSourceText,
  trackProgressSummary,
  type TrackHandoffSignal,
} from "../../lib/tracksView.js";
import { StepComposer, type StepDraft } from "./StepComposer.js";

const STATUS_DOT: Record<string, string> = { active: "bg-accent", concluded: "bg-ink-3", parked: "bg-ink-3" };

function uniqueTags(tags: readonly string[]): string[] {
  return [...new Set(tags)];
}

export interface TrackListItemProps {
  track: Track;
  steps: TrackStep[];
  now?: Date;
  signal?: TrackHandoffSignal | null;
  statusTags?: readonly string[];
  onSubmitStep?: (draft: StepDraft) => Promise<void> | void;
}

export function TrackListItem({
  track,
  steps,
  now = new Date(),
  signal,
  statusTags = [],
  onSubmitStep,
}: TrackListItemProps) {
  const [expanded, setExpanded] = useState(false);
  const latestSteps = track.status === "active" ? latestStepsForCard(steps) : [];

  return (
    <article className="rounded-card border border-border bg-surface transition hover:bg-surface-hover">
      <Link to={`/tracks/${track.id}`} className="block px-3 py-3 focus:outline-none focus:ring-1 focus:ring-accent">
        <span className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-pill ${STATUS_DOT[track.status] ?? "bg-ink-3"}`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-sm text-ink">{track.title}</span>
              {signal && (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 text-xs ${TRACK_COURT_META[signal.court].badgeClass}`}
                >
                  {TRACK_COURT_META[signal.court].laneLabel}
                  <span>#{signal.tag}</span>
                </span>
              )}
            </span>
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
                {uniqueTags(step.tags).map((tag) => (
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
      {track.status === "active" && onSubmitStep && (
        <div>
          <div className="flex justify-end border-t border-border px-3 py-2">
            <button
              type="button"
              aria-label="写一步"
              onClick={() => setExpanded((current) => !current)}
              className="rounded-ctl border border-border px-3 py-1.5 text-sm text-ink-2 transition hover:border-accent hover:text-accent"
            >
              写一步
            </button>
          </div>
          {expanded && (
            <StepComposer
              surface="inline"
              submitLabel="写入这一步"
              statusTags={statusTags}
              onSubmit={(draft) => {
                void Promise.resolve(onSubmitStep(draft)).then(() => setExpanded(false));
              }}
            />
          )}
        </div>
      )}
    </article>
  );
}
