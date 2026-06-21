import { ArrowLeft } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon.js";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { appendUserStep, closeCurrentStep, getTrack, listTrackSteps, setTrackStatus } from "../../lib/tracks.js";
import { currentStepId } from "../../lib/tracksView.js";
import { RefChip } from "./RefChip.js";
import { StepComposer, type StepDraft } from "./StepComposer.js";
import { TrackTimeline } from "./TrackTimeline.js";

const STATUS_LABEL: Record<string, string> = { active: "推进中", concluded: "已收束", parked: "已搁置" };
const STATUS_ORDER: { value: "active" | "concluded" | "parked"; label: string }[] = [
  { value: "active", label: "推进中" },
  { value: "concluded", label: "收束" },
  { value: "parked", label: "搁置" },
];

export default function TrackDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  // ?? null 把三态分开:undefined=查询未落(加载中)、null=查到但不存在、实体=命中。
  const track = useLiveQuery(async () => (await getTrack(id)) ?? null, [id]);
  const steps = useLiveQuery(() => listTrackSteps(id), [id], []);
  const { syncAfterWrite } = useSyncContext();

  const isActive = track != null && track.status === "active";
  const hasOpenStep = currentStepId(steps) !== null;

  async function addStep(draft: StepDraft): Promise<void> {
    if (!track) return;
    await appendUserStep({ trackId: track.id, content: draft.content, mode: draft.mode, tags: draft.tags });
    syncAfterWrite();
  }

  async function closeStep(): Promise<void> {
    if (!track) return;
    await closeCurrentStep(track.id);
    syncAfterWrite();
  }

  async function changeStatus(status: "active" | "concluded" | "parked"): Promise<void> {
    if (!track || track.status === status) return;
    await setTrackStatus(track.id, status);
    syncAfterWrite();
  }

  return (
    <div className="min-h-full bg-page text-ink">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 pb-24">
        <Link to="/tracks" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <Icon icon={ArrowLeft} size={16} />
          轨道
        </Link>
        {track === undefined ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">正在加载...</p>
        ) : track === null ? (
          <p className="rounded-card bg-surface px-3 py-6 text-center text-sm text-ink-3">轨道不存在</p>
        ) : (
          <>
            <header className="mb-3 rounded-card border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <h1 className="break-words text-lg font-medium text-ink">{track.title}</h1>
                <span className="rounded-pill bg-surface-hover px-2 py-0.5 text-xs text-ink-2">
                  {STATUS_LABEL[track.status] ?? track.status}
                </span>
              </div>
              {track.summary && <p className="mt-1 text-sm text-ink-2">{track.summary}</p>}
              {track.refs.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {track.refs.map((refItem) => (
                    <RefChip key={`${refItem.kind}:${refItem.id}`} refItem={refItem} />
                  ))}
                </div>
              )}
              <div className="mt-3 inline-flex rounded-ctl bg-surface-elevated p-0.5">
                {STATUS_ORDER.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={track.status === item.value}
                    onClick={() => void changeStatus(item.value)}
                    className={`rounded-ctl px-3 py-1 text-xs transition ${
                      track.status === item.value ? "bg-accent text-page" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </header>
            {isActive && <StepComposer onSubmit={(draft) => void addStep(draft)} />}
            {isActive && hasOpenStep && (
              <button
                type="button"
                onClick={() => void closeStep()}
                className="mb-3 w-full rounded-ctl border border-border bg-surface px-3 py-2 text-sm text-ink-2 hover:border-accent hover:text-accent"
              >
                闭合当前步
              </button>
            )}
            <TrackTimeline steps={steps} />
          </>
        )}
      </div>
    </div>
  );
}
