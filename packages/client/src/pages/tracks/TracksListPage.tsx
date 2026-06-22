import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { useSyncContext } from "../../contexts/SyncContext.js";
import {
  trackActionTagTexts,
  useTrackActionTagConfigs,
} from "../../lib/settings/trackActionTagsSetting.js";
import { TRACK_COURT_META } from "../../lib/trackCourts.js";
import { addTrack, appendUserStep, listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import {
  collectStatusFacets,
  filterTracksByStatusTags,
  groupStepsByTrack,
  groupTracksByHandoffCourt,
  partitionTracks,
  sortTracksForBoard,
} from "../../lib/tracksView.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";
import { loadBoardView, saveBoardView, type BoardView } from "./boardViewPref.js";
import { NewTrackComposer } from "./NewTrackComposer.js";
import type { StepDraft } from "./StepComposer.js";
import { TrackListItem } from "./TrackListItem.js";
import { TrackStatusFacetPanel } from "./TrackStatusFacetPanel.js";

const BOARD_VIEW_OPTIONS: { value: BoardView; label: string }[] = [
  { value: "flat", label: "扁平列表" },
  { value: "grouped", label: "按该谁了分组" },
];

export default function TracksListPage() {
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const allSteps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const actionTagConfigs = useTrackActionTagConfigs();
  const actionTags = useMemo(() => trackActionTagTexts(actionTagConfigs), [actionTagConfigs]);
  const { syncAfterWrite } = useSyncContext();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [boardView, setBoardView] = useState<BoardView>(() => loadBoardView());

  const { active, archived } = partitionTracks(tracks);
  const byTrack = groupStepsByTrack(allSteps);
  const facets = collectStatusFacets(tracks, byTrack, actionTagConfigs);
  const flatFiltered = filterTracksByStatusTags(active, byTrack, selectedTags, actionTagConfigs);
  const flatItems = sortTracksForBoard(flatFiltered, byTrack, actionTagConfigs);
  const lanes = groupTracksByHandoffCourt(active, byTrack, actionTagConfigs);

  useEffect(() => {
    const visibleTags = new Set(facets.map((facet) => facet.tag));
    setSelectedTags((current) => {
      const next = current.filter((tag) => visibleTags.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [facets]);

  async function create(title: string): Promise<void> {
    await addTrack({ title });
    syncAfterWrite();
  }

  async function addStep(trackId: string, draft: StepDraft): Promise<void> {
    await appendUserStep({ trackId, content: draft.content, mode: draft.mode, tags: draft.tags });
    syncAfterWrite();
  }

  function toggleTag(tag: string): void {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  function changeBoardView(view: BoardView): void {
    setBoardView(view);
    saveBoardView(view);
    if (view === "grouped") setSelectedTags([]);
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24">
        <NewTrackComposer onCreate={(title) => void create(title)} />
        <div className="mb-3 rounded-card border border-border bg-surface p-3">
          <SegmentedControl
            options={BOARD_VIEW_OPTIONS}
            value={boardView}
            onChange={changeBoardView}
            ariaLabel="轨道看板视图"
            className="w-full"
          />
        </div>
        {boardView === "flat" && <TrackStatusFacetPanel facets={facets} selectedTags={selectedTags} onToggle={toggleTag} />}
        {boardView === "flat" ? (
          flatItems.length === 0 ? (
            <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">
              {selectedTags.length > 0 ? "没有命中这些状态标签的进行中轨道" : "还没有进行中的轨道"}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {flatItems.map((item) => (
                <li key={item.track.id}>
                  <TrackListItem
                    track={item.track}
                    steps={byTrack.get(item.track.id) ?? []}
                    signal={item.signal}
                    statusTags={actionTags}
                    onSubmitStep={(draft) => void addStep(item.track.id, draft)}
                  />
                </li>
              ))}
            </ul>
          )
        ) : active.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">还没有进行中的轨道</p>
        ) : (
          <div className="space-y-3">
            {lanes.map((lane, index) => (
              <details key={lane.court} open={index === 0 || lane.items.length > 0} className="rounded-card border border-border bg-surface">
                <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-ink">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${TRACK_COURT_META[lane.court].dotClass}`} />
                    {TRACK_COURT_META[lane.court].laneLabel}
                  </span>
                  <span className="text-xs text-ink-3">{lane.items.length}</span>
                </summary>
                {lane.items.length > 0 ? (
                  <ul className="flex flex-col gap-2 border-t border-border p-2">
                    {lane.items.map((item) => (
                      <li key={item.track.id}>
                        <TrackListItem
                          track={item.track}
                          steps={byTrack.get(item.track.id) ?? []}
                          signal={item.signal}
                          statusTags={actionTags}
                          onSubmitStep={(draft) => void addStep(item.track.id, draft)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="border-t border-border px-3 py-3 text-sm text-ink-3">这一栏暂时没有轨道</p>
                )}
              </details>
            ))}
          </div>
        )}
        {archived.length > 0 && (
          <div className="mt-4">
            <CollapsibleSection title="已归档" count={archived.length}>
              <ul className="flex flex-col gap-2">
                {archived.map((track) => (
                  <li key={track.id}>
                    <TrackListItem track={track} steps={byTrack.get(track.id) ?? []} />
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          </div>
        )}
      </div>
    </div>
  );
}
