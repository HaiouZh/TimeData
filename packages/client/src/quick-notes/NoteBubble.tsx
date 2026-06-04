import type { QuickNote } from "@timedata/shared";
import { useLayoutEffect, useRef, useState } from "react";
import { looksLikeMarkdown } from "./looksLikeMarkdown.ts";
import NoteMeta from "./NoteMeta.tsx";
import QuickNoteContent from "./QuickNoteContent.tsx";

/** 折叠态最大高度，约 7-8 行。 */
const COLLAPSED_MAX_PX = 168;
/** 测高容差，避免临界高度反复抖动。 */
const OVERFLOW_SLOP_PX = 8;

export default function NoteBubble({ note, pending = false }: { note: QuickNote; pending?: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const text = note.text;
  const isAgent = note.source === "agent";
  const sourceLabel = note.sourceLabel ?? "助手";
  const markdownLayout = looksLikeMarkdown(text);
  const inlineSpacer = <span aria-hidden="true" className="inline-block h-[1em] w-[4.25rem]" />;

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const measure = () => {
      const nextCanExpand = text.length > 0 && el.scrollHeight > COLLAPSED_MAX_PX + OVERFLOW_SLOP_PX;
      setCanExpand((current) => (current === nextCanExpand ? current : nextCanExpand));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const collapsed = canExpand && !expanded;

  return (
    <div>
      {isAgent && (
        <div className="mb-1 text-[11px] font-medium text-sky-100/85">
          {sourceLabel}
        </div>
      )}
      <div className="relative">
        <div
          ref={contentRef}
          className="overflow-hidden transition-[max-height] duration-200"
          style={{ maxHeight: collapsed ? COLLAPSED_MAX_PX : undefined }}
        >
          <QuickNoteContent text={note.text} trailing={markdownLayout ? undefined : inlineSpacer} />
        </div>

        {collapsed && (
          <div className="pointer-events-none -mt-8 h-8 bg-gradient-to-t from-slate-900/95 to-transparent" />
        )}

        {!canExpand && markdownLayout ? (
          <div className="mt-1 flex justify-end">
            <NoteMeta occurredAt={note.occurredAt} pending={pending} agent={isAgent} />
          </div>
        ) : null}

        {!canExpand && !markdownLayout ? (
          <NoteMeta
            occurredAt={note.occurredAt}
            pending={pending}
            agent={isAgent}
            className="absolute bottom-0 right-0 z-10"
          />
        ) : null}
      </div>

      {canExpand && (
        <div className="mt-1 flex items-center justify-between gap-3">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
            className="text-xs font-medium text-emerald-300/90 transition hover:text-emerald-200"
          >
            {expanded ? "收起" : "展开"}
          </button>
          <NoteMeta occurredAt={note.occurredAt} pending={pending} agent={isAgent} />
        </div>
      )}
    </div>
  );
}
