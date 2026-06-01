import type { QuickNote } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DateNav from "../components/DateNav.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { addQuickNote, deleteQuickNote, listQuickNotesByDate, updateQuickNote } from "../lib/quickNotes.ts";
import { groupQuickNotesForDisplay } from "../lib/quickNoteDisplay.ts";
import { getDateString } from "../lib/time.ts";
import { deleteQuickNotesByRange } from "../quick-notes/deleteQuickNotesRange.ts";
import { exportQuickNotesJsonByDate, exportQuickNotesMarkdownByDate } from "../quick-notes/exportQuickNotes.ts";
import { downloadQuickNotesJson, downloadQuickNotesMarkdown } from "../quick-notes/fileDownload.ts";

function normalizeDateParam(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export default function QuickNotesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getDateString(new Date());
  const queryDate = normalizeDateParam(searchParams.get("date"));
  const [date, setDate] = useState(queryDate ?? today);
  const [draftText, setDraftText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const { confirm, dialog } = useConfirm();

  const notes = useLiveQuery(() => listQuickNotesByDate(date), [date]) || [];
  const displayItems = useMemo(() => groupQuickNotesForDisplay(notes), [notes]);

  useEffect(() => {
    const normalized = queryDate ?? today;
    setDate(normalized);
  }, [queryDate, today]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [displayItems.length]);

  function handleDateChange(nextDate: string) {
    setDate(nextDate);
    setSearchParams(nextDate === today ? {} : { date: nextDate });
  }

  async function handleSend() {
    if (saving) return;
    if (!draftText.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await addQuickNote(draftText);
      setDraftText("");
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => inputRef.current?.focus());
      } else {
        inputRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function startEditing(note: QuickNote) {
    setEditingId(note.id);
    setEditingText(note.text);
    setError(null);
  }

  async function saveEditing(note: QuickNote) {
    if (!editingText.trim()) {
      setError("速记内容不能为空");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateQuickNote(note.id, { text: editingText });
      setEditingId(null);
      setEditingText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
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
    if (editingId === note.id) {
      setEditingId(null);
      setEditingText("");
    }
  }

  async function handleExportJson() {
    setError(null);
    setStatus(null);
    try {
      const backup = await exportQuickNotesJsonByDate(date);
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
      const markdown = await exportQuickNotesMarkdownByDate(date);
      await downloadQuickNotesMarkdown(markdown, date);
      setStatus("已导出速记 Markdown。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function handleDeleteDate() {
    const confirmed = await confirm({
      title: "删除当天速记？",
      body: `${date} 的速记会被删除，不影响时间记录。建议先导出需要保留的内容。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!confirmed) return;

    const result = await deleteQuickNotesByRange(date, date);
    setStatus(`已删除 ${result.deleted} 条速记。`);
  }

  return (
    <div className="flex min-h-full flex-col bg-slate-950">
      <DateNav date={date} onDateChange={handleDateChange} />
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2">
        <h1 className="text-base font-medium text-slate-100">记录</h1>
        <div className="flex items-center gap-2">
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

      <section className="flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-28" aria-label="速记列表">
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
          const isEditing = editingId === note.id;
          return (
            <article key={item.key} className="flex justify-end">
              <div className="max-w-[88%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white shadow-sm">
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      aria-label="编辑速记内容"
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      onInput={(event) => setEditingText(event.currentTarget.value)}
                      rows={3}
                      className="w-full resize-none rounded-md bg-blue-700 px-2 py-1 text-sm text-white placeholder-blue-200 outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditingText("");
                        }}
                        className="rounded bg-blue-700 px-2 py-1 text-xs text-blue-100"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(note)}
                        className="rounded bg-red-700 px-2 py-1 text-xs text-white"
                      >
                        删除
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEditing(note)}
                        disabled={saving}
                        className="rounded bg-white px-2 py-1 text-xs text-blue-700 disabled:opacity-50"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`编辑速记：${note.text}`}
                    onClick={() => startEditing(note)}
                    className="block w-full whitespace-pre-wrap break-words text-left leading-relaxed"
                  >
                    {note.text}
                  </button>
                )}
              </div>
            </article>
          );
        })}
        <div ref={listEndRef} />
      </section>

      {error && <p className="fixed bottom-24 left-4 right-4 text-sm text-red-300">{error}</p>}
      {status && <p className="fixed bottom-24 left-4 right-4 text-sm text-slate-400">{status}</p>}

      <form
        className="fixed bottom-[49px] left-0 right-0 border-t border-slate-800 bg-slate-900 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            aria-label="速记输入"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onInput={(event) => setDraftText(event.currentTarget.value)}
            rows={1}
            placeholder="记一条..."
            className="max-h-28 min-h-11 flex-1 resize-none rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!draftText.trim() || saving}
            className="h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </form>
      {dialog}
    </div>
  );
}
