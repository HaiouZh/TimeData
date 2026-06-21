import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link } from "react-router-dom";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { addTrack, listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { actionableInbox, groupStepsByTrack, partitionTracks } from "../../lib/tracksView.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";
import { NewTrackComposer } from "./NewTrackComposer.js";
import { TrackInboxItem } from "./TrackInboxItem.js";
import { TrackListItem } from "./TrackListItem.js";

type ListTab = "all" | "inbox";

export default function TracksListPage() {
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const allSteps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const actionTags = useTrackActionTags();
  const { syncAfterWrite } = useSyncContext();
  const [tab, setTab] = useState<ListTab>("all");
  const now = new Date();

  const { active, archived } = partitionTracks(tracks);
  const byTrack = groupStepsByTrack(allSteps);
  const inbox = actionableInbox(tracks, byTrack, actionTags);

  async function create(title: string): Promise<void> {
    await addTrack({ title });
    syncAfterWrite();
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24">
        <SegmentedControl
          ariaLabel="轨道视图"
          className="mb-3"
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: "全部" },
            { value: "inbox", label: inbox.length > 0 ? `轮到我 ${inbox.length}` : "轮到我" },
          ]}
        />

        {tab === "inbox" ? (
          actionTags.length === 0 ? (
            <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">
              还没有配置行动标签。去{" "}
              <Link to="/settings/tracks" className="text-accent underline">
                设置 · 轨道行动标签
              </Link>{" "}
              添加。
            </p>
          ) : inbox.length === 0 ? (
            <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">暂无轮到你的步骤</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {inbox.map((item) => (
                <TrackInboxItem key={item.step.id} entry={item} now={now} />
              ))}
            </ul>
          )
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
