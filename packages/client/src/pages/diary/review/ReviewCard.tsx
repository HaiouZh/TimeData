import { NotePencil, Plus } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Icon } from "../../../components/Icon.js";
import type { DiaryBatchEntry } from "../../../lib/diary/diaryApi.js";
import DiaryMarkdown from "./DiaryMarkdown.js";

interface ReviewCardProps {
  date: string;
  label: string;
  entry: DiaryBatchEntry | undefined;
  loading: boolean;
  minHeight: number;
}

export default function ReviewCard({ date, label, entry, loading, minHeight }: ReviewCardProps) {
  const exists = Boolean(entry?.exists);

  return (
    <div className="flex flex-col overflow-hidden rounded-ctl border border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="td-text-caption font-medium text-ink">{label}</span>
        <Link
          to={`/diary?date=${date}`}
          aria-label={exists ? `打开 ${label} 日记` : `创建 ${label} 日记`}
          className="flex size-7 items-center justify-center rounded-full text-ink-2 transition hover:bg-surface-hover hover:text-ink"
        >
          <Icon icon={exists ? NotePencil : Plus} size={16} />
        </Link>
      </div>
      <div className="overflow-y-auto px-3 py-2" style={{ minHeight, maxHeight: minHeight }}>
        {loading ? (
          <p className="td-text-caption text-ink-3">加载中…</p>
        ) : exists ? (
          <DiaryMarkdown content={entry?.content ?? ""} />
        ) : (
          <p className="td-text-caption text-ink-3">无内容</p>
        )}
      </div>
    </div>
  );
}
