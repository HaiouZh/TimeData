import type { QuickNote } from "@timedata/shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { useLongPress } from "../hooks/useLongPress.ts";
import { groupQuickNotesForDisplay } from "../lib/quickNoteDisplay.ts";
import { addQuickNote, deleteQuickNote, updateQuickNote } from "../lib/quickNotes.ts";
import { getDateString } from "../lib/time.ts";
import QuickNoteActionMenu from "../quick-notes/QuickNoteActionMenu.tsx";
import { copyText } from "../quick-notes/clipboard.ts";
import { deleteQuickNotesByRange } from "../quick-notes/deleteQuickNotesRange.ts";
import { exportQuickNotesJsonByDate, exportQuickNotesMarkdownByDate } from "../quick-notes/exportQuickNotes.ts";
import { downloadQuickNotesJson, downloadQuickNotesMarkdown } from "../quick-notes/fileDownload.ts";
import { useQuickNoteTimeline } from "../quick-notes/useQuickNoteTimeline.ts";

const SCROLL_TRIGGER_PX = 48;
const INPUT_MAX_HEIGHT_PX = 160;

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

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
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
      listEndRef.current?.scrollIntoView?.({ block: "end" });
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
    <div className="flex min-h-full flex-col bg-slate-950">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950 px-4 py-2">
        <input
          type="date"
          aria-label="跳转日期"
          value={jumpDate}
          onChange={(event) => handleJumpDateChange(event.target.value)}
          className="min-w-0 rounded-lg bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        />
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExportMarkdown()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-slate-300"
          >
            MD
          </button>
          <button
            type="button"
            onClick={() => void handleExportJson()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-slate-300"
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteDate()}
            className="rounded-lg bg-red-950 px-3 py-1.5 text-sm text-red-200"
          >
            清理
          </button>
        </div>
      </header>

      <section
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-28"
        aria-label="速记列表"
      >
        {timeline.hasOlder && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={() => void timeline.loadOlder()}
              className="rounded-full bg-slate-900 px-3 py-1 text-xs text-slate-400"
            >
              加载更早
            </button>
          </div>
        )}

        {displayItems.map((item) => {
          if (item.type === "date") {
            return (
              <div key={item.key} className="text-center text-xs text-slate-500">
                {item.label}
              </div>
            );
          }
          if (item.type === "time") {
            return (
              <div key={item.key} className="pt-2 text-center text-xs text-slate-500">
                {item.label}
              </div>
            );
          }

          const note = item.note;
          return (
            <article key={item.key} className="flex justify-end">
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
                className="max-w-[88%] select-none whitespace-pre-wrap break-words rounded-lg bg-blue-600 px-3 py-2 text-sm leading-relaxed text-white shadow-sm"
              >
                {note.text}
              </div>
            </article>
          );
        })}
        <div ref={listEndRef} />
      </section>

      {!timeline.atLatest && (
        <button
          type="button"
          onClick={() => {
            stickBottomRef.current = true;
            void timeline.resetToLatest();
          }}
          className="fixed bottom-32 right-4 rounded-full bg-slate-800 px-3 py-2 text-xs text-slate-200 shadow-lg"
        >
          ↓ 最新
        </button>
      )}

      {error && <p className="fixed bottom-24 left-4 right-4 text-sm text-red-300">{error}</p>}
      {status && <p className="fixed bottom-24 left-4 right-4 text-sm text-slate-400">{status}</p>}

      <form
        className="fixed bottom-[49px] left-0 right-0 border-t border-slate-800 bg-slate-900 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        {editingId && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-300">
            <span className="truncate">编辑中：{draftText.slice(0, 40)}</span>
            <button type="button" aria-label="取消编辑" onClick={cancelEditing} className="ml-2 text-slate-400">
              ✕
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            aria-label="速记输入"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onInput={(event) => setDraftText(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={editingId ? "修改这条速记..." : "记一条..."}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!draftText.trim() || saving}
            className="h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-40"
          >
            {editingId ? "保存" : "发送"}
          </button>
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
