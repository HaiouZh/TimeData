import { Link } from "react-router-dom";
import { formatStepDuration, type InboxEntry, stepSourceText } from "../../lib/tracksView.js";

// 收件箱条目:整行 Link 进轨道详情(triage 视图,不展开 refs——RefChip 是 <a>,会嵌套非法)。
// 条目永远是当前开口步,故历时一律"进行中"。
export function TrackInboxItem({ entry, now }: { entry: InboxEntry; now: Date }) {
  const { track, step } = entry;
  const duration = formatStepDuration(step.startedAt, step.endedAt, now);

  return (
    <li>
      <Link
        to={`/tracks/${track.id}`}
        className="block rounded-card border border-accent bg-accent-soft p-3 shadow-elev1 transition hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span className="min-w-0 truncate font-medium text-ink">{track.title}</span>
          <span data-source={step.source} className="rounded-pill bg-surface-elevated px-2 py-0.5 text-ink-2">
            {stepSourceText(step)}
          </span>
          <span>进行中 · 已历时{duration}</span>
        </div>
        {step.content && (
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{step.content}</p>
        )}
        {step.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {step.tags.map((tag) => (
              <span key={tag} className="rounded-pill bg-surface-hover px-2 py-0.5 text-xs text-ink-2">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </Link>
    </li>
  );
}
