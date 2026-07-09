import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { useAgentExecTags } from "../../lib/settings/trackAgentExecTagsSetting.js";
import { addTrack, appendUserStep, listAllTrackSteps, listTracks } from "../../lib/tracks.js";
import { type DispatchGroupKey, dispatchItems, dispatchStats, groupDispatchItems } from "../../lib/tracksDispatch.js";
import { groupStepsByTrack, partitionTracks } from "../../lib/tracksView.js";
import { CollapsibleSection } from "../todo/CollapsibleSection.js";
import { NewTrackComposer } from "./NewTrackComposer.js";
import type { StepDraft } from "./StepComposer.js";
import { type TrackBadgeTone, TrackListItem } from "./TrackListItem.js";

// 分组视觉分层（spec 判定表）：等我接=警示色、agent 在跑=紫系（agent 语义色沿用 --color-data-purple 惯例）、停滞=弱化、推进中=常规。
const GROUP_HEADER_CLASSES: Record<DispatchGroupKey, string> = {
  "awaiting-me": "text-warn",
  "agent-running": "text-data-purple",
  "in-progress": "text-ink-2",
  stalled: "text-ink-3",
};

const GROUP_BADGE_TONES: Record<DispatchGroupKey, TrackBadgeTone> = {
  "awaiting-me": "warn",
  "agent-running": "purple",
  "in-progress": "default",
  stalled: "default",
};

// 调度台：一线一卡，按 等我接/agent在跑/推进中/停滞 分组；顶部统计带答「此刻几条在并发」。
// 同时服务窄屏路由页与宽屏壳左列（TracksShell）。
export function TracksBoard() {
  const tracks = useLiveQuery(() => listTracks(), [], []);
  const allSteps = useLiveQuery(() => listAllTrackSteps(), [], []);
  const actionTags = useTrackActionTags();
  const agentExecTags = useAgentExecTags();
  const navigate = useNavigate();
  const selectedTrackId = useMatch("/tracks/:id")?.params.id ?? null;

  const { active, archived } = partitionTracks(tracks);
  const byTrack = useMemo(() => groupStepsByTrack(allSteps), [allSteps]);
  const items = useMemo(
    () => dispatchItems(active, byTrack, actionTags, agentExecTags, new Date()),
    [active, byTrack, actionTags, agentExecTags],
  );
  const groups = useMemo(() => groupDispatchItems(items), [items]);
  const stats = useMemo(() => dispatchStats(items), [items]);

  async function create(title: string): Promise<void> {
    // 建完直接进详情写第一步（宽屏=右栏出详情，窄屏=整页详情）。
    const track = await addTrack({ title });
    navigate(`/tracks/${track.id}`);
  }

  async function addStep(trackId: string, draft: StepDraft): Promise<void> {
    await appendUserStep({ trackId, content: draft.content, mode: draft.mode, tags: draft.tags });
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24">
        <NewTrackComposer onCreate={(title) => create(title)} />
        <p data-testid="dispatch-stats" className="td-num mb-3 td-text-caption text-ink-2">
          等我接 {stats.awaiting} · agent 在跑 {stats.agentRunning} · 停滞 {stats.stalled}
        </p>
        {items.length === 0 ? (
          <p className="rounded-card bg-surface px-3 py-6 td-text-body text-center text-ink-3">还没有进行中的轨道</p>
        ) : (
          groups.map((group) => (
            <section key={group.key} data-testid={`dispatch-group-${group.key}`} className="mb-4">
              <h2 className={`mb-2 td-text-caption ${GROUP_HEADER_CLASSES[group.key]}`}>
                {group.label} <span className="td-num">{group.items.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <li key={item.track.id}>
                    <TrackListItem
                      track={item.track}
                      steps={byTrack.get(item.track.id) ?? []}
                      signal={item.signal}
                      badgeTone={GROUP_BADGE_TONES[group.key]}
                      stalledDays={item.stalledDays}
                      selected={item.track.id === selectedTrackId}
                      statusTags={actionTags}
                      onSubmitStep={(draft) => addStep(item.track.id, draft)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {archived.length > 0 && (
          <div className="mt-4">
            <CollapsibleSection title="已归档" count={archived.length}>
              <ul className="flex flex-col gap-2">
                {archived.map((track) => (
                  <li key={track.id}>
                    <TrackListItem
                      track={track}
                      steps={byTrack.get(track.id) ?? []}
                      selected={track.id === selectedTrackId}
                    />
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
