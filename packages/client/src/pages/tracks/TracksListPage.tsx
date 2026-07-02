import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { addTrack, appendUserStep, listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import {
  boardItemsForTracks,
  collectStatusFacetsFromItems,
  filterBoardItemsByStatusTags,
  groupStepsByTrack,
  partitionTracks,
} from "../../lib/tracksView.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";
import { NewTrackComposer } from "./NewTrackComposer.js";
import type { StepDraft } from "./StepComposer.js";
import { TrackListItem } from "./TrackListItem.js";
import { TrackStatusFacetPanel } from "./TrackStatusFacetPanel.js";

export default function TracksListPage() {
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const allSteps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const actionTags = useTrackActionTags();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const { active, archived } = partitionTracks(tracks);
  const byTrack = useMemo(() => groupStepsByTrack(allSteps), [allSteps]);
  const activeItems = useMemo(() => boardItemsForTracks(active, byTrack, actionTags), [active, byTrack, actionTags]);
  const facets = useMemo(() => collectStatusFacetsFromItems(activeItems, actionTags), [activeItems, actionTags]);
  const visibleItems = useMemo(
    () => filterBoardItemsByStatusTags(activeItems, selectedTags),
    [activeItems, selectedTags],
  );

  useEffect(() => {
    const visibleTags = new Set(facets.map((facet) => facet.tag));
    setSelectedTags((current) => {
      const next = current.filter((tag) => visibleTags.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [facets]);

  async function create(title: string): Promise<void> {
    await addTrack({ title });
  }

  async function addStep(trackId: string, draft: StepDraft): Promise<void> {
    await appendUserStep({ trackId, content: draft.content, mode: draft.mode, tags: draft.tags });
  }

  function toggleTag(tag: string): void {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24">
        <NewTrackComposer onCreate={(title) => void create(title)} />
        <TrackStatusFacetPanel facets={facets} selectedTags={selectedTags} onToggle={toggleTag} />
        {visibleItems.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 td-text-body text-center text-ink-3">
            {selectedTags.length > 0 ? "没有命中这些看板信号的进行中轨道" : "还没有进行中的轨道"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleItems.map((item) => (
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
