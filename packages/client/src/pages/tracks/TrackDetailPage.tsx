import { ArrowLeft } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../../components/Icon.js";
import { getTrack, listTrackSteps } from "../../lib/tracks.js";
import { RefChip } from "./RefChip.js";
import { TrackTimeline } from "./TrackTimeline.js";

const STATUS_LABEL: Record<string, string> = { active: "推进中", concluded: "已收束", parked: "已搁置" };

export default function TrackDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  // ?? null 把三态分开:undefined=查询未落(加载中)、null=查到但不存在、实体=命中。
  // 避免有效轨道首帧闪"轨道不存在"。
  const track = useLiveQuery(async () => (await getTrack(id)) ?? null, [id]);
  const steps = useLiveQuery(() => listTrackSteps(id), [id], []);

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
                  {track.refs.map((refItem, index) => (
                    <RefChip key={`${refItem.kind}:${refItem.id}:${index}`} refItem={refItem} />
                  ))}
                </div>
              )}
            </header>
            <TrackTimeline steps={steps} />
          </>
        )}
      </div>
    </div>
  );
}
