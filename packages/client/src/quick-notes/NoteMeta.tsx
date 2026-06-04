import { formatLocalClock } from "../lib/quickNoteDisplay.ts";

interface NoteMetaProps {
  occurredAt: string;
  pending: boolean;
  agent?: boolean;
  className?: string;
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="size-3"
      aria-label="待上传"
      role="img"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      className="size-3.5"
      aria-label="已上传"
      role="img"
    >
      <path d="M5 12.5l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NoteMeta({ occurredAt, pending, agent = false, className = "" }: NoteMetaProps) {
  const colorClass = agent ? "text-sky-100/70" : "text-slate-500";
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
      {pending ? <ClockIcon /> : <CheckIcon />}
    </span>
  );
}
