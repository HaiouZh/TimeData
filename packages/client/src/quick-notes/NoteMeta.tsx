import { Check, Clock } from "@phosphor-icons/react";
import { Icon } from "../components/Icon.js";
import { formatLocalClock } from "../lib/quickNoteDisplay.ts";

interface NoteMetaProps {
  occurredAt: string;
  pending: boolean;
  agent?: boolean;
  className?: string;
}

export default function NoteMeta({ occurredAt, pending, agent = false, className = "" }: NoteMetaProps) {
  const colorClass = agent ? "text-sky-100/80" : "text-slate-500";
  return (
    <span
      className={[
        "inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px] leading-none tabular-nums",
        colorClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <time dateTime={occurredAt}>{formatLocalClock(occurredAt)}</time>
      {pending ? <Icon icon={Clock} size={12} label="待上传" /> : <Icon icon={Check} size={14} label="已上传" />}
    </span>
  );
}
