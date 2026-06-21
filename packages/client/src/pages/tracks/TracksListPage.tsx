import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { addTrack, listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { collectStatusFacets, filterTracksByStatusTags, groupStepsByTrack, partitionTracks } from "../../lib/tracksView.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";
import { NewTrackComposer } from "./NewTrackComposer.js";
import { TrackListItem } from "./TrackListItem.js";
import { TrackStatusFacetPanel } from "./TrackStatusFacetPanel.js";

export default function TracksListPage() {
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const allSteps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const actionTags = useTrackActionTags();
  const { syncAfterWrite } = useSyncContext();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const { active, archived } = partitionTracks(tracks);
  const byTrack = groupStepsByTrack(allSteps);
  const facets = collectStatusFacets(tracks, byTrack, actionTags);
  const visibleActive = filterTracksByStatusTags(active, byTrack, selectedTags);

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

  function toggleTag(tag: string): void {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24">
        <NewTrackComposer onCreate={(title) => void create(title)} />
        <TrackStatusFacetPanel facets={facets} selectedTags={selectedTags} onToggle={toggleTag} />
        {visibleActive.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">
            {selectedTags.length > 0 ? "没有命中这些状态标签的进行中轨道" : "还没有进行中的轨道"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleActive.map((track) => (
              <li key={track.id}>
                <TrackListItem track={track} steps={byTrack.get(track.id) ?? []} />
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
