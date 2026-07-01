import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { GoalMemberRef } from "@timedata/shared";
import { localDateString } from "@timedata/shared";
import { type DragEvent, type ReactNode, useState } from "react";
import { Icon } from "../../components/Icon.js";
import type {
  GoalTaskCandidate,
  GoalTaskCandidateGroup,
  GoalTaskCandidateGroupKey,
  GoalTrackCandidate,
  GoalTrackCandidateGroup,
} from "./goalMemberCandidates.js";
import { writeDragRef } from "./goalMemberDragData.js";

export type GoalCandidateInteraction = { mode: "drag" } | { mode: "click"; onSelect: (ref: GoalMemberRef) => void };

export interface GoalCandidateListProps {
  tab: "tasks" | "tracks";
  taskGroups: GoalTaskCandidateGroup[];
  trackGroups: GoalTrackCandidateGroup[];
  emptyLabel: string;
  interaction: GoalCandidateInteraction;
}

const TASK_GROUP_COPY: Record<GoalTaskCandidateGroupKey, string> = {
  today: "今天",
  inbox: "收件箱",
  scheduled: "已排期",
};

const TRACK_GROUP_COPY: Record<string, string> = {
  active: "active",
  parked: "parked",
  concluded: "concluded",
};

const rootButtonBase = "min-h-14 flex-1 rounded-row px-3 py-2 text-left hover:bg-surface-hover";
const trackButtonBase =
  "min-h-16 w-full rounded-row border border-border bg-surface px-3 py-2 text-left hover:bg-surface-hover";

function taskMeta(candidate: GoalTaskCandidate): string {
  const tags = candidate.task.tags.length > 0 ? ` · #${candidate.task.tags.join(" #")}` : "";
  const overdue = candidate.overdue ? " · 逾期" : "";
  const date =
    candidate.group === "scheduled" && candidate.task.scheduledAt
      ? ` · ${localDateString(new Date(candidate.task.scheduledAt))}`
      : "";
  return `${TASK_GROUP_COPY[candidate.group]}${overdue}${date}${tags}`;
}

function trackMeta(candidate: GoalTrackCandidate): string {
  const signal = candidate.signal ? ` · #${candidate.signal.tag}` : "";
  return `${TRACK_GROUP_COPY[candidate.track.status]}${signal}`;
}

export function GoalCandidateList({ tab, taskGroups, trackGroups, emptyLabel, interaction }: GoalCandidateListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (tab === "tasks") {
    if (taskGroups.length === 0) return <EmptyCandidates label={emptyLabel} />;
    return (
      <>
        {taskGroups.map((group) => (
          <CandidateGroup key={group.key} title={group.label}>
            {group.items.map((candidate) => (
              <TaskRow
                key={candidate.task.id}
                candidate={candidate}
                interaction={interaction}
                expanded={expanded.has(candidate.task.id)}
                onToggle={() => toggle(candidate.task.id)}
              />
            ))}
          </CandidateGroup>
        ))}
      </>
    );
  }

  if (trackGroups.length === 0) return <EmptyCandidates label={emptyLabel} />;
  return (
    <>
      {trackGroups.map((group) => (
        <CandidateGroup key={group.key} title={group.label}>
          {group.items.map((candidate) => (
            <TrackRow key={candidate.track.id} candidate={candidate} interaction={interaction} />
          ))}
        </CandidateGroup>
      ))}
    </>
  );
}

function TaskRow({
  candidate,
  interaction,
  expanded,
  onToggle,
}: {
  candidate: GoalTaskCandidate;
  interaction: GoalCandidateInteraction;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { task, children } = candidate;
  const hasChildren = children.length > 0;
  const rootClass =
    interaction.mode === "drag" ? `${rootButtonBase} cursor-grab active:cursor-grabbing` : rootButtonBase;

  return (
    <div className="space-y-1">
      <div className="flex items-stretch rounded-row border border-border bg-surface">
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${expanded ? "折叠" : "展开"}子任务 ${task.title}`}
            aria-expanded={expanded}
            onClick={onToggle}
            className="flex w-9 shrink-0 flex-col items-center justify-center gap-0.5 text-ink-3 hover:text-ink"
          >
            <Icon icon={expanded ? CaretDown : CaretRight} size={16} />
            <span className="td-text-caption leading-none tabular-nums">{children.length}</span>
          </button>
        ) : (
          <span className="w-9 shrink-0" aria-hidden="true" />
        )}
        {interaction.mode === "drag" ? (
          <button
            type="button"
            aria-label={`拖动任务 ${task.title}`}
            data-tray-ref={`task:${task.id}`}
            draggable
            onDragStart={(event: DragEvent<HTMLElement>) =>
              writeDragRef(event.dataTransfer, { kind: "task", id: task.id })
            }
            className={rootClass}
          >
            <span className="block td-text-body text-ink">{task.title}</span>
            <span className="block td-text-caption text-ink-3">{taskMeta(candidate)}</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={`添加任务 ${task.title}`}
            onClick={() => interaction.onSelect({ kind: "task", id: task.id })}
            className={rootClass}
          >
            <span className="block td-text-body text-ink">{task.title}</span>
            <span className="block td-text-caption text-ink-3">{taskMeta(candidate)}</span>
          </button>
        )}
      </div>
      {expanded && hasChildren && (
        <ul className="space-y-1 pl-11">
          {children.map((child) => (
            <li
              key={child.id}
              data-child-ref={`task:${child.id}`}
              className="rounded-row border border-border-hairline bg-surface px-3 py-1.5 td-text-body text-ink-2"
            >
              {child.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrackRow({
  candidate,
  interaction,
}: {
  candidate: GoalTrackCandidate;
  interaction: GoalCandidateInteraction;
}) {
  const { track, latestStep } = candidate;
  const body = (
    <>
      <span className="block td-text-body text-ink">{track.title}</span>
      <span className="block td-text-caption text-ink-3">{trackMeta(candidate)}</span>
      {latestStep && <span className="mt-1 block truncate td-text-caption text-ink-2">{latestStep.content}</span>}
    </>
  );
  if (interaction.mode === "drag") {
    return (
      <button
        type="button"
        aria-label={`拖动轨道 ${track.title}`}
        data-tray-ref={`track:${track.id}`}
        draggable
        onDragStart={(event: DragEvent<HTMLElement>) =>
          writeDragRef(event.dataTransfer, { kind: "track", id: track.id })
        }
        className={`${trackButtonBase} cursor-grab active:cursor-grabbing`}
      >
        {body}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={`添加轨道 ${track.title}`}
      onClick={() => interaction.onSelect({ kind: "track", id: track.id })}
      className={trackButtonBase}
    >
      {body}
    </button>
  );
}

function CandidateGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 td-text-caption text-ink-3">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function EmptyCandidates({ label }: { label: string }) {
  return <p className="rounded-row border border-dashed border-border px-3 py-4 td-text-body text-ink-3">{label}</p>;
}
