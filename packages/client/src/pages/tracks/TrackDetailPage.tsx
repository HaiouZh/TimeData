import { ArrowLeft, Check, PencilSimple, X } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon.js";
import { useSyncContext } from "../../contexts/SyncContext.js";
import { useTrackActionTags } from "../../lib/settings/trackActionTagsSetting.js";
import { appendUserStep, closeCurrentStep, getTrack, listTrackSteps, setTrackStatus, updateTrack } from "../../lib/tracks.js";
import { currentStepId } from "../../lib/tracksView.js";
import { RefChip } from "./RefChip.js";
import { StepComposer, type StepDraft } from "./StepComposer.js";
import { TrackTimeline } from "./TrackTimeline.js";

const STATUS_LABEL: Record<string, string> = { active: "推进中", concluded: "已收束", parked: "已搁置" };

export default function TrackDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  // ?? null 把三态分开:undefined=查询未落(加载中)、null=查到但不存在、实体=命中。
  const track = useLiveQuery(async () => (await getTrack(id)) ?? null, [id]);
  const steps = useLiveQuery(() => listTrackSteps(id), [id], []);
  const { syncAfterWrite } = useSyncContext();
  const actionTags = useTrackActionTags();
  const [editingMeta, setEditingMeta] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");

  const isActive = track != null && track.status === "active";
  const hasOpenStep = currentStepId(steps) !== null;

  useEffect(() => {
    if (!track || editingMeta) return;
    setTitleDraft(track.title);
    setSummaryDraft(track.summary ?? "");
  }, [editingMeta, track]);

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

  async function saveMeta(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!track) return;
    await updateTrack(track.id, {
      title: titleDraft,
      summary: summaryDraft.trim() ? summaryDraft : null,
    });
    syncAfterWrite();
    setEditingMeta(false);
  }

  function cancelMetaEdit(): void {
    if (!track) return;
    setTitleDraft(track.title);
    setSummaryDraft(track.summary ?? "");
    setEditingMeta(false);
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
              {editingMeta ? (
                <form onSubmit={(event) => void saveMeta(event)} className="space-y-2">
                  <input
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    aria-label="轨道标题"
                    className="w-full rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <textarea
                    value={summaryDraft}
                    onChange={(event) => setSummaryDraft(event.target.value)}
                    aria-label="轨道摘要"
                    rows={2}
                    className="w-full resize-none rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-sm leading-6 text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelMetaEdit}
                      className="inline-flex items-center gap-1 rounded-ctl border border-border px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
                    >
                      <Icon icon={X} size={16} />
                      取消
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded-ctl bg-accent px-3 py-1.5 text-sm text-page"
                    >
                      <Icon icon={Check} size={16} />
                      保存轨道
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h1 className="break-words text-lg font-medium text-ink">{track.title}</h1>
                      {track.summary && <p className="mt-1 text-sm text-ink-2">{track.summary}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingMeta(true)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl bg-surface-elevated text-ink-2 hover:text-accent"
                      aria-label="编辑轨道"
                    >
                      <Icon icon={PencilSimple} size={16} />
                    </button>
                    <span className="rounded-pill bg-surface-hover px-2 py-0.5 text-xs text-ink-2">
                      {STATUS_LABEL[track.status] ?? track.status}
                    </span>
                  </div>
                  {track.refs.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {track.refs.map((refItem) => (
                        <RefChip key={`${refItem.kind}:${refItem.id}`} refItem={refItem} />
                      ))}
                    </div>
                  )}
                </>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-ctl bg-surface-elevated px-2.5 py-1 text-xs text-ink-2">
                  状态 · {STATUS_LABEL[track.status] ?? track.status}
                </span>
                {track.status === "active" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void changeStatus("concluded")}
                      className="rounded-ctl border border-border px-3 py-1.5 text-sm text-ink-2 hover:border-accent hover:text-accent"
                    >
                      收束
                    </button>
                    <button
                      type="button"
                      onClick={() => void changeStatus("parked")}
                      className="rounded-ctl border border-border px-3 py-1.5 text-sm text-ink-2 hover:border-accent hover:text-accent"
                    >
                      搁置
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void changeStatus("active")}
                    className="rounded-ctl bg-accent px-3 py-1.5 text-sm text-page"
                  >
                    重新推进
                  </button>
                )}
              </div>
            </header>
            {isActive && <StepComposer onSubmit={(draft) => void addStep(draft)} statusTags={actionTags} />}
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
