import type { QuickNote } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
import { useSyncContext } from "../contexts/SyncContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.ts";
import { useEntryMutations } from "../hooks/useEntries.js";
import { useLongPress } from "../hooks/useLongPress.ts";
import { punchNow } from "../lib/punch.js";
import { formatLocalClock, groupQuickNotesForDisplay } from "../lib/quickNoteDisplay.ts";
import { addQuickNote, deleteQuickNote, listPinnedQuickNotes, setQuickNotePinned, updateQuickNote } from "../lib/quickNotes.ts";
import { readTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import { addTask } from "../lib/tasks.js";
import { formatTime, getDateString } from "../lib/time.ts";
import { copyText } from "../quick-notes/clipboard.ts";
import { pickCurrentDateDivider } from "../quick-notes/currentDate.ts";
import { deleteQuickNotesByIds } from "../quick-notes/deleteQuickNotesByIds.ts";
import { deleteQuickNotesByRange } from "../quick-notes/deleteQuickNotesRange.ts";
import {
  exportQuickNotesJsonByDate,
  exportQuickNotesJsonForNotes,
  exportQuickNotesMarkdownByDate,
  quickNotesMarkdown,
} from "../quick-notes/exportQuickNotes.ts";
import { downloadQuickNotesJson, downloadQuickNotesMarkdown } from "../quick-notes/fileDownload.ts";
import HighlightedText from "../quick-notes/HighlightedText.tsx";
import { shouldShowJumpToLatest } from "../quick-notes/jumpToLatest.ts";
import NoteBubble from "../quick-notes/NoteBubble.tsx";
import QuickNoteActionMenu from "../quick-notes/QuickNoteActionMenu.tsx";
import { searchQuickNotes } from "../quick-notes/searchQuickNotes.ts";
import { parseSearchTerms } from "../quick-notes/searchTerms.ts";
import { useQuickNoteTimeline } from "../quick-notes/useQuickNoteTimeline.ts";
import { useUnsyncedQuickNoteIds } from "../quick-notes/useUnsyncedQuickNoteIds.ts";

const SCROLL_TRIGGER_PX = 48;
const INPUT_MAX_HEIGHT_PX = 160;
const DEFAULT_COMPOSER_INSET_PX = 128;
const COMPOSER_BOTTOM_GAP_PX = 16;
const KEYBOARD_BOTTOM_GAP_THRESHOLD_PX = 80;
const STATUS_AUTO_DISMISS_MS = 2400;
const ACTION_TOAST_DISMISS_MS = 6000;
const BUBBLE_HIDE_DELAY_MS = 1200;

interface MenuTarget {
  note: QuickNote;
  x: number;
  y: number;
}

interface ActionToast {
  message: string;
  actions?: { label: string; onClick: () => void }[];
}

function normalizeDateParam(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function isSoftKeyboardLikelyOpen(): boolean {
  if (typeof window === "undefined") return false;
  const viewport = window.visualViewport;
  if (!viewport || window.innerHeight <= 0) return false;

  const visualViewportBottomGap = window.innerHeight - viewport.height - viewport.offsetTop;
  return visualViewportBottomGap > KEYBOARD_BOTTOM_GAP_THRESHOLD_PX;
}

function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      className="size-4"
    >
      <path d="M9 4.5h6" />
      <path d="M10 4.5c0 3-1.5 4.5-3.5 6.5l6.5 6.5c2-2 3.5-3.5 6.5-3.5" />
      <path d="M14.5 4.5 19.5 9" />
      <path d="M4.5 19.5 10 14" />
    </svg>
  );
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
  const [actionToast, setActionToast] = useState<ActionToast | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [composerInsetPx, setComposerInsetPx] = useState(DEFAULT_COMPOSER_INSET_PX);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [bubbleDate, setBubbleDate] = useState<{ label: string; localDate: string } | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [softKeyboardOpen, setSoftKeyboardOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const composeDraftRef = useRef("");
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleRafRef = useRef<number | null>(null);
  const bubbleKeyRef = useRef<string | null>(null);
  const pressedNoteRef = useRef<QuickNote | null>(null);
  const stickBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const preserveAnchorRef = useRef(false);
  const didInitJumpRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastClientHeightRef = useRef(0);

  const { confirm, dialog } = useConfirm();
  const { hidden: navHidden, setHidden: setNavHidden } = useBottomNav();
  const { syncAfterWrite } = useSyncContext();
  const { deleteEntry } = useEntryMutations();
  const navigate = useNavigate();
  const timeline = useQuickNoteTimeline();
  const unsyncedQuickNoteIds = useUnsyncedQuickNoteIds();
  const pinnedNotes = useLiveQuery(() => listPinnedQuickNotes(), []) ?? [];
  const inputInteractionActive = composerFocused || searchOpen || softKeyboardOpen;
  const navOffsetPx = navHidden ? 0 : BOTTOM_NAV_HEIGHT_PX;
  const bottomInsetPx = selectionMode || searchOpen ? COMPOSER_BOTTOM_GAP_PX : composerInsetPx;
  const displayItems = useMemo(
    () => groupQuickNotesForDisplay(timeline.notes.filter((note) => !note.pinned), { today }),
    [timeline.notes, today],
  );
  const selectableNotes = useMemo(() => {
    const byId = new Map<string, QuickNote>();
    for (const note of timeline.notes) byId.set(note.id, note);
    for (const note of pinnedNotes) byId.set(note.id, note);
    return [...byId.values()];
  }, [timeline.notes, pinnedNotes]);
  const debouncedQuery = useDebouncedValue(searchQuery, 200);
  const searchTerms = useMemo(() => parseSearchTerms(debouncedQuery), [debouncedQuery]);
  const searchResults = useLiveQuery(() => searchQuickNotes(debouncedQuery), [debouncedQuery]) ?? [];
  const hasQuery = searchTerms.length > 0;

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

  useEffect(
    () => () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      if (bubbleRafRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(bubbleRafRef.current);
      }
    },
    [],
  );

  useEffect(() => () => setNavHidden(false), [setNavHidden]);

  useEffect(() => {
    if (inputInteractionActive) {
      setNavHidden(true);
      return;
    }

    setNavHidden(false);
  }, [inputInteractionActive, setNavHidden]);

  useEffect(() => {
    const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!viewport) return;

    const handleViewportChange = () => setSoftKeyboardOpen(isSoftKeyboardLikelyOpen());
    handleViewportChange();
    viewport.addEventListener("resize", handleViewportChange);
    viewport.addEventListener("scroll", handleViewportChange);

    return () => {
      viewport.removeEventListener("resize", handleViewportChange);
      viewport.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    if (selectionMode) {
      setPinnedOpen(false);
      setSearchOpen(false);
    }
  }, [selectionMode]);

  // 只在列表内容（新增 / 加载更多 / 删除）或搜索、最新窗口状态变化时校正滚动位置。
  // 不能每次 render 都跑：否则滚动驱动的 setState（日期气泡、导航显隐、atBottom）会反复
  // 把 scrollTop 弹回底部，在安卓 WebView 上表现为缓慢下滑时整体抖动、页面却不动。
  const listItemCount = displayItems.length;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (preserveAnchorRef.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      preserveAnchorRef.current = false;
      return;
    }

    if (listItemCount > 0 && !searchOpen && stickBottomRef.current && timeline.atLatest) {
      el.scrollTop = el.scrollHeight;
    }
  }, [listItemCount, searchOpen, timeline.atLatest]);

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
    setAtBottom(stickBottomRef.current);
    if (!searchOpen && el.scrollTop <= SCROLL_TRIGGER_PX && timeline.hasOlder) {
      prevScrollHeightRef.current = el.scrollHeight;
      preserveAnchorRef.current = true;
      void timeline.loadOlder();
    }
    if (!searchOpen && !timeline.atLatest && stickBottomRef.current) {
      void timeline.loadNewer();
    }

    // 隐藏 / 显示底部导航会让导航高度动画（49↔0），进而改变本滚动容器的可视高度。
    // 在底部时，容器变高会被浏览器钳制 / 滚动锚定强行改写 scrollTop 并触发 onScroll，
    // 若据此判定方向就会把导航反向翻回，形成「导航高度 → scrollTop → 导航高度」的死循环，
    // 桌面端（真实滚动条 + 滚动锚定）表现为底部持续抖动。因此 clientHeight 发生变化的这一帧
    // 只重置基线、不参与方向判定，等容器尺寸稳定后再恢复滚动隐藏逻辑。
    const top = el.scrollTop;
    const viewportResized = el.clientHeight !== lastClientHeightRef.current;
    lastClientHeightRef.current = el.clientHeight;
    const SHOW_NEAR_TOP_PX = 24;
    const DIR_DELTA_PX = 6;
    if (!viewportResized) {
      if (top <= SHOW_NEAR_TOP_PX) {
        setNavHidden(false);
      } else if (top > lastScrollTopRef.current + DIR_DELTA_PX) {
        setNavHidden(true);
      } else if (top < lastScrollTopRef.current - DIR_DELTA_PX) {
        setNavHidden(false);
      }
    }
    lastScrollTopRef.current = top;

    scheduleDateBubble();
  }

  // 日期气泡的「当前分隔」扫描需要 querySelectorAll + 读 offsetTop（强制重排），原本每个
  // scroll 事件都跑且每次新建对象 setState，滚动期间反复重渲染。这里用 rAF 把扫描合并到每帧
  // 一次，并对相同日期去抖（key 不变就不 setState），尽量减少滚动时的重排与重渲染。
  function updateDateBubble() {
    const el = scrollRef.current;
    if (!el) return;

    const top = el.scrollTop;
    const dividers = Array.from(el.querySelectorAll<HTMLElement>("[data-date-label]")).map((node) => ({
      label: node.dataset.dateLabel ?? "",
      localDate: node.dataset.localDate ?? today,
      offsetTop: node.offsetTop,
    }));
    const divider = pickCurrentDateDivider(dividers, top);
    if (!divider) return;

    const key = `${divider.localDate}|${divider.label}`;
    if (bubbleKeyRef.current !== key) {
      bubbleKeyRef.current = key;
      setBubbleDate({ label: divider.label, localDate: divider.localDate });
    }
    setBubbleVisible(true);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => {
      bubbleTimerRef.current = null;
      setBubbleVisible(false);
    }, BUBBLE_HIDE_DELAY_MS);
  }

  function scheduleDateBubble() {
    if (typeof requestAnimationFrame !== "function") {
      updateDateBubble();
      return;
    }
    if (bubbleRafRef.current !== null) return;
    bubbleRafRef.current = requestAnimationFrame(() => {
      bubbleRafRef.current = null;
      updateDateBubble();
    });
  }

  function focusInput() {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    inputRef.current?.focus();
  }

  function openSearch() {
    setActionsOpen(false);
    setPinnedOpen(false);
    setSearchOpen(true);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => searchInputRef.current?.focus());
      return;
    }
    searchInputRef.current?.focus();
  }

  function closeSearch(options: { resetTimeline?: boolean } = {}) {
    setSearchOpen(false);
    setSearchQuery("");
    if (options.resetTimeline ?? true) {
      stickBottomRef.current = true;
      void timeline.resetToLatest();
    }
  }

  function handleResultClick(note: QuickNote) {
    const localDate = getDateString(new Date(note.occurredAt));
    closeSearch({ resetTimeline: false });
    if (note.pinned) setPinnedOpen(true);
    handleJumpDateChange(localDate);
  }

  // 轻提示（已复制 / 已导出 / 已清理）几秒后自动消失，避免一直挂在底部直到切换页面。
  function showStatus(message: string) {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus(message);
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      setStatus(null);
    }, STATUS_AUTO_DISMISS_MS);
  }

  function showActionToast(toast: ActionToast) {
    if (actionToastTimerRef.current) clearTimeout(actionToastTimerRef.current);
    setActionToast(toast);
    actionToastTimerRef.current = setTimeout(() => {
      actionToastTimerRef.current = null;
      setActionToast(null);
    }, ACTION_TOAST_DISMISS_MS);
  }

  async function handlePunch() {
    setError(null);
    try {
      const result = await punchNow();
      if (!result.ok) {
        showStatus(result.reason === "no_range" ? "距上次记录还没有时间" : "请先在设置 · 杂项选择打点分类");
        return;
      }
      const { entry } = result;
      syncAfterWrite();
      showActionToast({
        message: `已打点 ${formatTime(entry.startTime)}–${formatTime(entry.endTime)}`,
        actions: [
          { label: "撤销", onClick: () => void handleUndoPunch(entry.id) },
          { label: "去时间轴", onClick: () => navigate(`/?date=${getDateString(new Date(entry.startTime))}`) },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "打点失败");
    }
  }

  async function handleUndoPunch(entryId: string) {
    await deleteEntry(entryId);
    syncAfterWrite();
    setActionToast(null);
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

  async function handleSaveTodo() {
    const text = draftText.trim();
    if (!text || saving) return;
    setError(null);
    try {
      const dest = await readTodoDefaultDestination();
      await addTask({ title: text, toInbox: dest === "inbox" });
      setDraftText("");
      syncAfterWrite();
      focusInput();
      showActionToast({
        message: dest === "inbox" ? "已放入收件箱" : "已加入今天",
        actions: [{ label: "去待办", onClick: () => navigate("/todo") }],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  }

  function startEditing(note: QuickNote) {
    if (!editingId) composeDraftRef.current = draftText;
    setPinnedOpen(false);
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
      showStatus("已复制");
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

  async function handleTogglePin(note: QuickNote) {
    setMenu(null);
    const nextPinned = !(note.pinned ?? false);
    await setQuickNotePinned(note.id, nextPinned);
    if (nextPinned) {
      setPinnedOpen(true);
    } else if (pinnedNotes.length <= 1) {
      setPinnedOpen(false);
    }
    syncAfterWrite();
  }

  function enterSelection(note: QuickNote) {
    setMenu(null);
    setActionsOpen(false);
    setPinnedOpen(false);
    setSearchOpen(false);
    setSelectionMode(true);
    setSelectedIds(new Set([note.id]));
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setExportMenuOpen(false);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectedNotes(): QuickNote[] {
    return selectableNotes
      .filter((note) => selectedIds.has(note.id))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  }

  async function handleBatchCopy() {
    const notes = selectedNotes();
    if (notes.length === 0) return;

    try {
      await copyText(notes.map((note) => note.text).join("\n\n"));
      showStatus(`已复制 ${notes.length} 条`);
      exitSelection();
    } catch {
      setError("复制失败");
    }
  }

  async function handleBatchExportMarkdown() {
    const notes = selectedNotes();
    if (notes.length === 0) return;

    const markdown = quickNotesMarkdown(`速记（${notes.length} 条）`, notes);
    await downloadQuickNotesMarkdown(markdown, `selection-${notes.length}`);
    showStatus("已导出 Markdown。");
    exitSelection();
  }

  async function handleBatchExportJson() {
    const notes = selectedNotes();
    if (notes.length === 0) return;

    const backup = exportQuickNotesJsonForNotes(notes);
    await downloadQuickNotesJson(backup);
    showStatus(`已导出 ${notes.length} 条 JSON。`);
    exitSelection();
  }

  async function handleBatchDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    const confirmed = await confirm({
      title: `删除 ${ids.length} 条速记？`,
      body: "删除后不会影响时间记录。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!confirmed) return;

    const result = await deleteQuickNotesByIds(ids);
    if (editingId && ids.includes(editingId)) cancelEditing();
    showStatus(`已删除 ${result.deleted} 条。`);
    if (result.deleted > 0) syncAfterWrite();
    exitSelection();
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
      showStatus(`已导出 ${backup.notes.length} 条速记 JSON。`);
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
      showStatus("已导出速记 Markdown。");
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
    showStatus(`已删除 ${result.deleted} 条速记。`);
    if (result.deleted > 0) syncAfterWrite();
  }

  function noteInteractionProps(note: QuickNote) {
    return {
      onClick: selectionMode ? () => toggleSelected(note.id) : undefined,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (selectionMode) return;
        pressedNoteRef.current = note;
        longPress.onPointerDown(event);
      },
      onPointerMove: longPress.onPointerMove,
      onPointerUp: longPress.onPointerUp,
      onPointerLeave: longPress.onPointerLeave,
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (selectionMode) {
          event.preventDefault();
          return;
        }
        pressedNoteRef.current = note;
        longPress.onContextMenu(event);
      },
    };
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 shrink-0 border-b border-slate-800/80 bg-slate-950/95 px-4 pb-2 pt-3 backdrop-blur sm:pb-3 sm:pt-4 sm:shadow-[0_14px_40px_rgba(2,6,23,0.22)]">
        {selectionMode ? (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
            <button
              type="button"
              aria-label="退出多选"
              onClick={exitSelection}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900/75 text-slate-300"
            >
              x
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">已选 {selectedIds.size} 条</span>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchCopy()}
              className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              复制
            </button>
            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                disabled={selectedIds.size === 0}
                onClick={() => setExportMenuOpen((open) => !open)}
                className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-200 disabled:cursor-not-allowed disabled:text-slate-600"
              >
                导出
              </button>
              {exportMenuOpen && (
                <>
                  <div role="presentation" className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 py-1 shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setExportMenuOpen(false);
                        void handleBatchExportMarkdown();
                      }}
                      className="block w-full px-4 py-3 text-left text-sm text-slate-200 hover:bg-slate-800"
                    >
                      Markdown
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setExportMenuOpen(false);
                        void handleBatchExportJson();
                      }}
                      className="block w-full px-4 py-3 text-left text-sm text-slate-200 hover:bg-slate-800"
                    >
                      JSON
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchDelete()}
              className="rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-1.5 text-sm font-medium text-red-300 disabled:cursor-not-allowed disabled:text-red-900"
            >
              删除
            </button>
          </div>
        ) : searchOpen ? (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
            <span aria-hidden className="text-slate-400">
              🔍
            </span>
            <input
              ref={searchInputRef}
              type="search"
              aria-label="搜索速记"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索速记…"
              className="min-w-0 flex-1 bg-transparent text-base text-slate-100 placeholder-slate-400 outline-none"
            />
            <button
              type="button"
              aria-label="退出搜索"
              onClick={() => closeSearch()}
              className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:text-slate-100"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <button
              type="button"
              aria-label="打点（记录到现在）"
              onClick={() => void handlePunch()}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900/75 text-base leading-none text-slate-300 transition hover:border-emerald-500/40 hover:text-slate-100 sm:size-11"
            >
              ⏱
            </button>
            <div className="min-w-0 flex-1">
              {!timeline.atLatest && (
                <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                  历史
                </span>
              )}
            </div>
            <label className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/80 px-2 py-1 text-right shadow-sm sm:rounded-2xl sm:px-3 sm:py-2">
              <span className="hidden text-[11px] text-slate-500 sm:block">日期</span>
              <input
                ref={dateInputRef}
                type="date"
                aria-label="跳转日期"
                value={jumpDate}
                onChange={(event) => handleJumpDateChange(event.target.value)}
                className="w-[7.5rem] bg-transparent text-xs font-medium text-slate-100 outline-none [color-scheme:dark] sm:mt-0.5 sm:w-36 sm:text-sm"
              />
            </label>

            {pinnedNotes.length > 0 && (
              <button
                type="button"
                aria-label={`${pinnedOpen ? "收起" : "查看"}置顶速记，${pinnedNotes.length} 条`}
                aria-haspopup="dialog"
                aria-expanded={pinnedOpen}
                onClick={() => {
                  setActionsOpen(false);
                  setPinnedOpen((open) => !open);
                }}
                className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900/75 text-slate-300 transition hover:border-emerald-500/40 hover:text-slate-100 sm:size-11"
              >
                <PinIcon />
                <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-emerald-300 px-1 text-[11px] font-semibold leading-5 text-slate-950">
                  {pinnedNotes.length}
                </span>
              </button>
            )}

            <button
              type="button"
              aria-label="搜索速记"
              onClick={openSearch}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-slate-800 bg-slate-900/75 text-base leading-none text-slate-300 transition hover:border-emerald-500/40 hover:text-slate-100 sm:size-11"
            >
              🔍
            </button>

            <div className="relative shrink-0">
              <button
                type="button"
                aria-label="更多操作"
                aria-haspopup="menu"
                aria-expanded={actionsOpen}
                onClick={() => {
                  setPinnedOpen(false);
                  setActionsOpen((open) => !open);
                }}
                className="flex size-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900/75 text-lg leading-none text-slate-300 transition hover:border-emerald-500/40 hover:text-slate-100 sm:size-11"
              >
                ⋯
              </button>
              {actionsOpen && (
                <>
                  <div
                    role="presentation"
                    className="fixed inset-0 z-40"
                    onClick={() => setActionsOpen(false)}
                  />
                  <div
                    role="menu"
                    aria-label="速记导出与清理"
                    className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 py-1 shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        void handleExportMarkdown();
                      }}
                      className="block w-full px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                    >
                      导出 Markdown
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        void handleExportJson();
                      }}
                      className="block w-full px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                    >
                      导出 JSON
                    </button>
                    <div className="my-1 h-px bg-slate-800" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        void handleDeleteDate();
                      }}
                      className="block w-full px-4 py-3 text-left text-sm font-medium text-red-300 transition hover:bg-red-950/40"
                    >
                      清理当天
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {!selectionMode && !searchOpen && pinnedOpen && pinnedNotes.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 px-4">
            <section
              aria-label="置顶速记"
              className="mx-auto flex max-h-[min(52vh,24rem)] w-full max-w-3xl flex-col gap-2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-3 shadow-2xl shadow-slate-950/60"
            >
              <p className="px-1 text-xs font-semibold text-slate-400">置顶 · {pinnedNotes.length}</p>
              {pinnedNotes.map((note) => {
                const isAgentNote = note.source === "agent";
                const selected = selectedIds.has(note.id);
                const pending = unsyncedQuickNoteIds.has(note.id);
                return (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`置顶速记：${note.text}`}
                    aria-pressed={selectionMode ? selected : undefined}
                    {...noteInteractionProps(note)}
                    style={{ WebkitTouchCallout: "none" }}
                    className={`relative max-w-full select-none rounded-xl border px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-emerald-500/35 focus:ring-2 focus:ring-emerald-400/40 ${
                      isAgentNote
                        ? "border-sky-700/55 bg-sky-950/70 hover:bg-sky-900/65"
                        : "border-slate-800 bg-slate-950/70"
                    } ${selected ? "ring-2 ring-emerald-400/70" : ""}`}
                  >
                    <NoteBubble note={note} pending={pending} />
                  </div>
                );
              })}
            </section>
          </div>
        )}
      </header>

      <section
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
        style={{ paddingBottom: bottomInsetPx, scrollPaddingBottom: bottomInsetPx }}
        aria-label="速记列表"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {searchOpen ? (
            !hasQuery ? (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-10 text-center text-sm text-slate-400">
                输入关键词搜索速记，空格分隔多个词表示同时包含。
              </div>
            ) : searchResults.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-10 text-center text-sm text-slate-400">
                没有匹配的速记
              </div>
            ) : (
              searchResults.map((note) => {
                const isAgentNote = note.source === "agent";
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => handleResultClick(note)}
                    className={`relative w-full rounded-2xl border px-4 py-2 text-left text-[15px] leading-relaxed text-slate-100 shadow-[0_12px_40px_rgba(2,6,23,0.18)] transition hover:border-emerald-500/35 ${
                      isAgentNote
                        ? "border-sky-700/55 bg-sky-950/70 hover:bg-sky-900/65"
                        : "border-slate-800 bg-slate-900/90 hover:bg-slate-900"
                    }`}
                  >
                    <time className="float-right ml-2 font-mono text-[11px] tabular-nums text-slate-500">
                      {formatLocalClock(note.occurredAt)}
                    </time>
                    {isAgentNote && (
                      <div className="mb-1 text-[11px] font-semibold text-sky-200/95">
                        {note.sourceLabel ?? "助手"}
                      </div>
                    )}
                    <HighlightedText text={note.text} terms={searchTerms} />
                  </button>
                );
              })
            )
          ) : (
            <>
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

              {!timeline.loading && displayItems.length === 0 && pinnedNotes.length === 0 && (
                <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/45 px-5 py-10 text-center">
                  <p className="text-sm font-medium text-slate-200">还没有速记</p>
                  <p className="mt-1 text-xs text-slate-400">写下一个想法、线索或待办，稍后再回来看。</p>
                </div>
              )}

              {displayItems.map((item) => {
                if (item.type === "date") {
                  return (
                    <div key={item.key} data-date-label={item.label} data-local-date={item.localDate} className="flex items-center gap-3 pt-1">
                      <div className="h-px flex-1 bg-slate-800" />
                      <div className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1 text-xs font-medium text-slate-400">
                        {item.label}
                      </div>
                      <div className="h-px flex-1 bg-slate-800" />
                    </div>
                  );
                }

                const note = item.note;
                const isAgentNote = note.source === "agent";
                const selected = selectedIds.has(note.id);
                const pending = unsyncedQuickNoteIds.has(note.id);
                return (
                  <article key={item.key}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`速记：${note.text}`}
                      aria-pressed={selectionMode ? selected : undefined}
                      {...noteInteractionProps(note)}
                      style={{ WebkitTouchCallout: "none" }}
                      className={`relative max-w-full select-none rounded-2xl border px-4 py-2 text-[15px] leading-relaxed text-slate-100 shadow-[0_12px_40px_rgba(2,6,23,0.18)] outline-none transition hover:border-emerald-500/35 focus:ring-2 focus:ring-emerald-400/40 ${
                        isAgentNote
                          ? "border-sky-700/55 bg-sky-950/70 hover:bg-sky-900/65"
                          : "border-slate-800 bg-slate-900/90 hover:bg-slate-900"
                      } ${selected ? "ring-2 ring-emerald-400/70" : ""}`}
                    >
                      {selectionMode && (
                        <span
                          aria-hidden="true"
                          className={`absolute right-2 top-2 flex size-5 items-center justify-center rounded-full border text-[11px] ${
                            selected
                              ? "border-emerald-300 bg-emerald-300 text-slate-950"
                              : "border-slate-600 bg-slate-950/60 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      )}
                      <NoteBubble note={note} pending={pending} />
                    </div>
                  </article>
                );
              })}
            </>
          )}
        </div>
      </section>

      {bubbleDate && !pinnedOpen && !searchOpen && (
        <label
          aria-label={`当前日期 ${bubbleDate.label}，点击选择日期`}
          className={`fixed left-1/2 top-[4.75rem] z-[35] -translate-x-1/2 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1 text-xs font-medium text-slate-200 shadow-lg backdrop-blur transition-opacity duration-300 sm:top-20 ${
            bubbleVisible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <span aria-hidden="true">{bubbleDate.label}</span>
          <input
            type="date"
            aria-label="选择当前浮层日期"
            value={bubbleDate.localDate}
            onChange={(event) => handleJumpDateChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [color-scheme:dark]"
          />
        </label>
      )}

      {!searchOpen && shouldShowJumpToLatest({ atBottom, atLatest: timeline.atLatest }) && (
        <button
          type="button"
          onClick={() => {
            stickBottomRef.current = true;
            setAtBottom(true);
            if (!timeline.atLatest) {
              void timeline.resetToLatest();
              return;
            }
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="fixed right-4 rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 shadow-lg shadow-slate-950/40 transition hover:border-emerald-500/45"
          style={{ bottom: navOffsetPx + bottomInsetPx }}
        >
          ↓ 最新
        </button>
      )}

      {error && (
        <p
          className="fixed left-4 right-4 mx-auto max-w-3xl rounded-2xl border border-red-900/60 bg-red-950/90 px-3 py-2 text-sm text-red-200 shadow-lg"
          style={{ bottom: navOffsetPx + bottomInsetPx }}
        >
          {error}
        </p>
      )}
      {status && (
        <p
          className="fixed left-4 right-4 mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-900/95 px-3 py-2 text-sm text-slate-300 shadow-lg"
          style={{ bottom: navOffsetPx + bottomInsetPx }}
        >
          {status}
        </p>
      )}
      {!searchOpen && !selectionMode && (
        <form
          ref={composerRef}
          aria-label="速记输入区"
          className="fixed left-0 right-0 border-t border-slate-800/80 bg-slate-950/95 p-2 shadow-[0_-18px_40px_rgba(2,6,23,0.42)] backdrop-blur transition-[bottom] duration-200 sm:p-3"
          style={{ bottom: navOffsetPx }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="mx-auto w-full max-w-3xl">
            {actionToast && (
              <div
                role="status"
                aria-label="捕捉操作反馈"
                className="mb-2 flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900/95 px-3 py-2 text-sm text-slate-100 shadow-lg"
              >
                <span className="min-w-0 flex-1 truncate">{actionToast.message}</span>
                {actionToast.actions?.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      setActionToast(null);
                      action.onClick();
                    }}
                    className="shrink-0 font-semibold text-emerald-300 transition hover:text-emerald-200"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
            {editingId && (
              <div className="mb-2 flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-100">
                <span className="truncate">正在编辑：{draftText.slice(0, 40)}</span>
                <button type="button" aria-label="取消编辑" onClick={cancelEditing} className="ml-2 text-emerald-200/75">
                  ✕
                </button>
              </div>
            )}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-1.5 shadow-sm sm:rounded-3xl sm:p-2">
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  aria-label="存为待办"
                  disabled={!draftText.trim() || saving}
                  onClick={() => void handleSaveTodo()}
                  className="h-11 shrink-0 rounded-2xl border border-slate-700 px-3 text-sm font-medium text-slate-200 transition hover:border-emerald-500/40 hover:text-slate-50 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600 sm:px-4"
                >
                  待办
                </button>
                <textarea
                  ref={inputRef}
                  aria-label="速记输入"
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  onInput={(event) => setDraftText(event.currentTarget.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setComposerFocused(true)}
                  onBlur={() => setComposerFocused(false)}
                  rows={1}
                  placeholder={editingId ? "修改这条速记..." : "捕捉一个当下想法..."}
                  className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-base leading-relaxed text-slate-100 placeholder-slate-400 outline-none"
                />
                <button
                  type="submit"
                  disabled={!draftText.trim() || saving}
                  className="h-11 shrink-0 rounded-2xl bg-emerald-400 px-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 sm:px-4"
                >
                  {editingId ? "保存" : "记录"}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {menu && (
        <QuickNoteActionMenu
          x={menu.x}
          y={menu.y}
          pinned={menu.note.pinned ?? false}
          onCopy={() => void handleCopy(menu.note)}
          onEdit={() => startEditing(menu.note)}
          onDelete={() => void handleDelete(menu.note)}
          onSelect={() => enterSelection(menu.note)}
          onTogglePin={() => void handleTogglePin(menu.note)}
          onClose={() => setMenu(null)}
        />
      )}
      {dialog}
    </div>
  );
}
