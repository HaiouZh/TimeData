import type { QuickNote } from "@timedata/shared";
import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { useLongPress } from "../hooks/useLongPress.ts";
import { groupQuickNotesForDisplay } from "../lib/quickNoteDisplay.ts";
import { addQuickNote, deleteQuickNote, updateQuickNote } from "../lib/quickNotes.ts";
import { getDateString } from "../lib/time.ts";
import { copyText } from "../quick-notes/clipboard.ts";
import { deleteQuickNotesByRange } from "../quick-notes/deleteQuickNotesRange.ts";
import { exportQuickNotesJsonByDate, exportQuickNotesMarkdownByDate } from "../quick-notes/exportQuickNotes.ts";
import { downloadQuickNotesJson, downloadQuickNotesMarkdown } from "../quick-notes/fileDownload.ts";
import QuickNoteActionMenu from "../quick-notes/QuickNoteActionMenu.tsx";
import { useQuickNoteTimeline } from "../quick-notes/useQuickNoteTimeline.ts";

const SCROLL_TRIGGER_PX = 48;
const INPUT_MAX_HEIGHT_PX = 160;
const DEFAULT_COMPOSER_INSET_PX = 128;
const COMPOSER_BOTTOM_GAP_PX = 16;
const BOTTOM_NAV_OFFSET_PX = 49;

interface MenuTarget {
  note: QuickNote;
  x: number;
  y: number;
}

function normalizeDateParam(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export default function QuickNotesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getDateString(new Date());
  const queryDate = normalizeDateParam(searchParams.get("date"));
  const [jumpDate, setJumpDate] = useState(queryDate ?? today);
  const [draftText, setDraftText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [composerInsetPx, setComposerInsetPx] = useState(DEFAULT_COMPOSER_INSET_PX);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composeDraftRef = useRef("");
  const pressedNoteRef = useRef<QuickNote | null>(null);
  const stickBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const preserveAnchorRef = useRef(false);
  const didInitJumpRef = useRef(false);

  const { confirm, dialog } = useConfirm();
  const { syncAfterWrite } = useSyncContext();
  const timeline = useQuickNoteTimeline();
  const displayItems = useMemo(() => groupQuickNotesForDisplay(timeline.notes), [timeline.notes]);
  const timelineStatus = timeline.loading
    ? "正在读取速记"
    : timeline.atLatest
      ? `当前窗口 ${timeline.notes.length} 条`
      : "正在查看历史窗口";

  const longPress = useLongPress(({ x, y }) => {
    const note = pressedNoteRef.current;
    if (note) setMenu({ note, x, y });
  });

  useEffect(() => {
    if (didInitJumpRef.current) return;
    didInitJumpRef.current = true;
    if (queryDate) void timeline.jumpToDate(queryDate);
  }, [queryDate, timeline.jumpToDate]);

  useEffect(() => {
    if (!queryDate) return;
    setJumpDate(queryDate);
  }, [queryDate]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (preserveAnchorRef.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      preserveAnchorRef.current = false;
      return;
    }

    if (stickBottomRef.current && timeline.atLatest) {
      el.scrollTop = el.scrollHeight;
    }
  });

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, INPUT_MAX_HEIGHT_PX);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
  });

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const height = composer.getBoundingClientRect().height;
    if (height <= 0) return;

    const nextInset = Math.ceil(height + COMPOSER_BOTTOM_GAP_PX);
    setComposerInsetPx((currentInset) => (Math.abs(currentInset - nextInset) > 1 ? nextInset : currentInset));
  });

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const target = entries[0]?.target;
      const height = target instanceof HTMLElement ? target.getBoundingClientRect().height : 0;
      if (height <= 0) return;
      const nextInset = Math.ceil(height + COMPOSER_BOTTOM_GAP_PX);
      setComposerInsetPx((currentInset) => (Math.abs(currentInset - nextInset) > 1 ? nextInset : currentInset));
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;

    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_TRIGGER_PX;
    if (el.scrollTop <= SCROLL_TRIGGER_PX && timeline.hasOlder) {
      prevScrollHeightRef.current = el.scrollHeight;
      preserveAnchorRef.current = true;
      void timeline.loadOlder();
    }
    if (!timeline.atLatest && stickBottomRef.current) {
      void timeline.loadNewer();
    }
  }

  function focusInput() {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    inputRef.current?.focus();
  }

  async function handleSubmit() {
    if (saving) return;
    const text = draftText.trim();
    if (!text) return;

    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      if (editingId) {
        await updateQuickNote(editingId, { text });
        setEditingId(null);
        setDraftText(composeDraftRef.current);
        composeDraftRef.current = "";
      } else {
        await addQuickNote(text);
        setDraftText("");
        stickBottomRef.current = true;
      }
      syncAfterWrite();
      focusInput();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function startEditing(note: QuickNote) {
    if (!editingId) composeDraftRef.current = draftText;
    setEditingId(note.id);
    setDraftText(note.text);
    setError(null);
    setStatus(null);
    focusInput();
  }

  function cancelEditing() {
    setEditingId(null);
    setDraftText(composeDraftRef.current);
    composeDraftRef.current = "";
    setError(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
      return;
    }
    if (event.key === "Escape" && editingId) {
      event.preventDefault();
      cancelEditing();
    }
  }

  async function handleCopy(note: QuickNote) {
    setError(null);
    try {
      await copyText(note.text);
      setStatus("已复制");
    } catch {
      setError("复制失败");
    }
  }

  async function handleDelete(note: QuickNote) {
    const confirmed = await confirm({
      title: "删除这条速记？",
      body: "删除后不会影响时间记录。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!confirmed) return;

    await deleteQuickNote(note.id);
    if (editingId === note.id) cancelEditing();
    syncAfterWrite();
  }

  function handleJumpDateChange(nextDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
    setJumpDate(nextDate);
    setSearchParams(nextDate === today ? {} : { date: nextDate });
    stickBottomRef.current = false;
    void timeline.jumpToDate(nextDate);
  }

  async function handleExportJson() {
    setError(null);
    setStatus(null);
    try {
      const backup = await exportQuickNotesJsonByDate(jumpDate);
      await downloadQuickNotesJson(backup);
      setStatus(`已导出 ${backup.notes.length} 条速记 JSON。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function handleExportMarkdown() {
    setError(null);
    setStatus(null);
    try {
      const markdown = await exportQuickNotesMarkdownByDate(jumpDate);
      await downloadQuickNotesMarkdown(markdown, jumpDate);
      setStatus("已导出速记 Markdown。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function handleDeleteDate() {
    const confirmed = await confirm({
      title: "删除当天速记？",
      body: `${jumpDate} 的速记会被删除，不影响时间记录。建议先导出需要保留的内容。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!confirmed) return;

    const result = await deleteQuickNotesByRange(jumpDate, jumpDate);
    setStatus(`已删除 ${result.deleted} 条速记。`);
    if (result.deleted > 0) syncAfterWrite();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
      <header className="shrink-0 border-b border-slate-800/80 bg-slate-950/95 px-4 pb-3 pt-4 shadow-[0_14px_40px_rgba(2,6,23,0.22)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300/80">QuickNote</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-50">速记</h1>
              <p className="mt-1 text-xs text-slate-400">{timelineStatus}</p>
            </div>
            <label className="rounded-2xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-right shadow-sm">
              <span className="block text-[11px] text-slate-500">日期</span>
              <input
                type="date"
                aria-label="跳转日期"
                value={jumpDate}
                onChange={(event) => handleJumpDateChange(event.target.value)}
                className="mt-0.5 w-36 bg-transparent text-sm font-medium text-slate-100 outline-none [color-scheme:dark]"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExportMarkdown()}
              className="rounded-full border border-slate-800 bg-slate-900/75 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-slate-100"
            >
              MD
            </button>
            <button
              type="button"
              onClick={() => void handleExportJson()}
              className="rounded-full border border-slate-800 bg-slate-900/75 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-emerald-500/40 hover:text-slate-100"
            >
              JSON
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteDate()}
              className="rounded-full border border-red-900/60 bg-red-950/50 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:border-red-500/60 hover:bg-red-950"
            >
              清理
            </button>
          </div>
        </div>
      </header>

      <section
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
        style={{ paddingBottom: composerInsetPx, scrollPaddingBottom: composerInsetPx }}
        aria-label="速记列表"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {timeline.hasOlder && (
            <div className="flex justify-center pb-1">
              <button
                type="button"
                onClick={() => void timeline.loadOlder()}
                className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-emerald-500/40 hover:text-slate-200"
              >
                加载更早
              </button>
            </div>
          )}

          {timeline.loading && (
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
              正在读取速记...
            </div>
          )}

          {!timeline.loading && displayItems.length === 0 && (
            <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-10 text-center">
              <p className="text-sm font-medium text-slate-200">还没有速记</p>
              <p className="mt-1 text-xs text-slate-500">写下一个想法、线索或待办，稍后再回来看。</p>
            </div>
          )}

          {displayItems.map((item) => {
            if (item.type === "date") {
              return (
                <div key={item.key} className="flex items-center gap-3 pt-1">
                  <div className="h-px flex-1 bg-slate-800" />
                  <div className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-xs font-medium text-slate-400">
                    {item.label}
                  </div>
                  <div className="h-px flex-1 bg-slate-800" />
                </div>
              );
            }
            if (item.type === "time") {
              return (
                <div key={item.key} className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-3 pt-1">
                  <time className="font-mono text-[11px] tabular-nums text-slate-500">{item.label}</time>
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-emerald-300/80" />
                    <div className="h-px flex-1 bg-slate-800/80" />
                  </div>
                </div>
              );
            }

            const note = item.note;
            return (
              <article key={item.key} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3">
                <div />
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`速记：${note.text}`}
                  onPointerDown={(event) => {
                    pressedNoteRef.current = note;
                    longPress.onPointerDown(event);
                  }}
                  onPointerMove={longPress.onPointerMove}
                  onPointerUp={longPress.onPointerUp}
                  onPointerLeave={longPress.onPointerLeave}
                  onContextMenu={(event) => {
                    pressedNoteRef.current = note;
                    longPress.onContextMenu(event);
                  }}
                  style={{ WebkitTouchCallout: "none" }}
                  className="max-w-full select-none whitespace-pre-wrap break-words rounded-2xl border border-slate-800 bg-slate-900/90 px-4 py-3 text-[15px] leading-relaxed text-slate-100 shadow-[0_12px_40px_rgba(2,6,23,0.18)] outline-none transition hover:border-emerald-500/35 hover:bg-slate-900 focus:ring-2 focus:ring-emerald-400/40"
                >
                  {note.text}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {!timeline.atLatest && (
        <button
          type="button"
          onClick={() => {
            stickBottomRef.current = true;
            void timeline.resetToLatest();
          }}
          className="fixed right-4 rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 shadow-lg shadow-slate-950/40 transition hover:border-emerald-500/45"
          style={{ bottom: BOTTOM_NAV_OFFSET_PX + composerInsetPx }}
        >
          ↓ 最新
        </button>
      )}

      {error && (
        <p
          className="fixed left-4 right-4 mx-auto max-w-3xl rounded-2xl border border-red-900/60 bg-red-950/90 px-3 py-2 text-sm text-red-200 shadow-lg"
          style={{ bottom: BOTTOM_NAV_OFFSET_PX + composerInsetPx }}
        >
          {error}
        </p>
      )}
      {status && (
        <p
          className="fixed left-4 right-4 mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/95 px-3 py-2 text-sm text-slate-300 shadow-lg"
          style={{ bottom: BOTTOM_NAV_OFFSET_PX + composerInsetPx }}
        >
          {status}
        </p>
      )}

      <form
        ref={composerRef}
        className="fixed bottom-[49px] left-0 right-0 border-t border-slate-800/80 bg-slate-950/95 p-3 shadow-[0_-18px_40px_rgba(2,6,23,0.42)] backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="mx-auto w-full max-w-3xl">
          {editingId && (
            <div className="mb-2 flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-100">
              <span className="truncate">正在编辑：{draftText.slice(0, 40)}</span>
              <button type="button" aria-label="取消编辑" onClick={cancelEditing} className="ml-2 text-emerald-200/75">
                ✕
              </button>
            </div>
          )}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-2 shadow-sm">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                aria-label="速记输入"
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                onInput={(event) => setDraftText(event.currentTarget.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={editingId ? "修改这条速记..." : "捕捉一个当下想法..."}
                className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-base leading-relaxed text-slate-100 placeholder-slate-500 outline-none"
              />
              <button
                type="submit"
                disabled={!draftText.trim() || saving}
                className="h-11 shrink-0 rounded-2xl bg-emerald-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              >
                {editingId ? "保存" : "记录"}
              </button>
            </div>
          </div>
        </div>
      </form>

      {menu && (
        <QuickNoteActionMenu
          x={menu.x}
          y={menu.y}
          onCopy={() => void handleCopy(menu.note)}
          onEdit={() => startEditing(menu.note)}
          onDelete={() => void handleDelete(menu.note)}
          onClose={() => setMenu(null)}
        />
      )}
      {dialog}
    </div>
  );
}
