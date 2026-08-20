import type { Goal, Track, TrackMilestone, TrackStep } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { type ReactElement, useCallback, useMemo } from "react";
import { db } from "../../db/index.js";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { useAgentExecTags } from "../../lib/settings/trackAgentExecTagsSetting.js";
import { useResumeTags } from "../../lib/settings/trackResumeTagsSetting.js";
import { useWaitExternalTags } from "../../lib/settings/trackWaitExternalTagsSetting.js";
import { buildTrackProjectIndex } from "../../lib/tasks/trackProjectIndex.js";
import { type DispatchItem, dispatchItems, groupDispatchItems } from "../../lib/tracksDispatch.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { TrackBucketRow } from "./TrackBucketRow.js";

export function useTrackBucketContext() {
  const actionTags = useTrackActionTags();
  const agentExecTags = useAgentExecTags();
  const waitExternalTags = useWaitExternalTags();
  const resumeTags = useResumeTags();
  const allMilestones = useLiveQuery(() => db.trackMilestones.toArray(), [], []) as TrackMilestone[];
  const goals = useLiveQuery(() => db.goals.toArray(), [], []) as Goal[];
  const milestonesByTrack = useMemo(() => {
    const map = new Map<string, TrackMilestone[]>();
    for (const row of allMilestones) {
      const list = map.get(row.trackId);
      if (list) list.push(row);
      else map.set(row.trackId, [row]);
    }
    return map;
  }, [allMilestones]);
  const projectIndex = useMemo(() => buildTrackProjectIndex(goals), [goals]);
  const buildItems = useCallback(
    (tracks: readonly Track[], stepsByTrack: Map<string, TrackStep[]>): DispatchItem[] =>
      dispatchItems([...tracks], stepsByTrack, actionTags, agentExecTags, waitExternalTags, resumeTags, new Date()),
    [actionTags, agentExecTags, waitExternalTags, resumeTags],
  );
  return { actionTags, agentExecTags, waitExternalTags, resumeTags, milestonesByTrack, projectIndex, buildItems };
}

export interface HandTrackRowsProps {
  tracks: readonly Track[];
  stepsByTrack: Map<string, TrackStep[]>;
  expandedTrackIds: ReadonlySet<string>;
  onToggleExpand: (trackId: string) => void;
  onError: (message: string) => void;
}

export function HandTrackRows({
  tracks,
  stepsByTrack,
  expandedTrackIds,
  onToggleExpand,
  onError,
}: HandTrackRowsProps): ReactElement | null {
  const ctx = useTrackBucketContext();
  const items = useMemo(() => ctx.buildItems(tracks, stepsByTrack), [tracks, stepsByTrack, ctx.buildItems]);
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <TrackBucketRow
          key={item.track.id}
          item={item}
          steps={stepsByTrack.get(item.track.id) ?? []}
          milestones={ctx.milestonesByTrack.get(item.track.id) ?? []}
          project={ctx.projectIndex.get(item.track.id) ?? null}
          expanded={expandedTrackIds.has(item.track.id)}
          onToggleExpand={onToggleExpand}
          inHand
          onError={onError}
        />
      ))}
    </div>
  );
}

export interface ProjectTrackRowsProps {
  trackIds: readonly string[];
  tracks: readonly Track[];
  stepsByTrack: Map<string, TrackStep[]>;
  expandedTrackIds: ReadonlySet<string>;
  onToggleExpand: (trackId: string) => void;
  onError: (message: string) => void;
}

export function ProjectTrackRows({
  trackIds,
  tracks,
  stepsByTrack,
  expandedTrackIds,
  onToggleExpand,
  onError,
}: ProjectTrackRowsProps): ReactElement | null {
  const ctx = useTrackBucketContext();
  const scoped = useMemo(() => tracks.filter((t) => trackIds.includes(t.id)), [tracks, trackIds]);
  const items = useMemo(() => ctx.buildItems(scoped, stepsByTrack), [scoped, stepsByTrack, ctx.buildItems]);
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <TrackBucketRow
          key={item.track.id}
          item={item}
          steps={stepsByTrack.get(item.track.id) ?? []}
          milestones={ctx.milestonesByTrack.get(item.track.id) ?? []}
          project={null}
          expanded={expandedTrackIds.has(item.track.id)}
          onToggleExpand={onToggleExpand}
          onError={onError}
        />
      ))}
    </div>
  );
}

export interface TrackBucketSectionProps {
  tracks: readonly Track[];
  stepsByTrack: Map<string, TrackStep[]>;
  sessionTrackIds: readonly string[];
  expandedTrackIds: ReadonlySet<string>;
  onToggleExpand: (trackId: string) => void;
  onError: (message: string) => void;
}

export function TrackBucketSection({
  tracks,
  stepsByTrack,
  sessionTrackIds,
  expandedTrackIds,
  onToggleExpand,
  onError,
}: TrackBucketSectionProps): ReactElement | null {
  const ctx = useTrackBucketContext();
  const eligible = useMemo(() => tracks.filter((t) => !sessionTrackIds.includes(t.id)), [tracks, sessionTrackIds]);
  const items = useMemo(() => ctx.buildItems(eligible, stepsByTrack), [eligible, stepsByTrack, ctx.buildItems]);
  const groups = useMemo(() => groupDispatchItems(items), [items]);
  if (items.length === 0) return null;
  return (
    <section data-section="todo-track-bucket">
      <CollapsibleSection title="轨道" count={items.length} defaultOpen>
        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="td-text-caption text-ink-3 px-2 py-1">{group.label}</h3>
            {group.items.map((item) => (
              <TrackBucketRow
                key={item.track.id}
                item={item}
                steps={stepsByTrack.get(item.track.id) ?? []}
                milestones={ctx.milestonesByTrack.get(item.track.id) ?? []}
                project={ctx.projectIndex.get(item.track.id) ?? null}
                expanded={expandedTrackIds.has(item.track.id)}
                onToggleExpand={onToggleExpand}
                onError={onError}
              />
            ))}
          </div>
        ))}
      </CollapsibleSection>
    </section>
  );
}
