import { useLiveQuery } from "dexie-react-hooks";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { addTrack, listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { groupStepsByTrack, partitionTracks } from "../../lib/tracksView.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";
import { NewTrackComposer } from "./NewTrackComposer.js";
import { TrackListItem } from "./TrackListItem.js";

export default function TracksListPage() {
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const allSteps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const { syncAfterWrite } = useSyncContext();
  const { active, archived } = partitionTracks(tracks);
  const byTrack = groupStepsByTrack(allSteps);

  async function create(title: string): Promise<void> {
    await addTrack({ title });
    syncAfterWrite();
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24">
        <NewTrackComposer onCreate={(title) => void create(title)} />
        {active.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">还没有进行中的轨道</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((track) => (
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
