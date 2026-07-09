import {
  ArrowDown,
  Check,
  DotsThree,
  MagnifyingGlass,
  Notebook,
  NotePencil,
  Plus,
  PushPin,
  Timer,
  X,
} from "@phosphor-icons/react";
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
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { ActionToastBar } from "../components/ui/ActionToastBar.tsx";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.ts";
import { useActionToast } from "../hooks/useActionToast.ts";
import { useEntryMutations } from "../hooks/useEntries.js";
import { useLongPress } from "../hooks/useLongPress.ts";
import { punchNow } from "../lib/punch.js";
import { formatLocalClock, groupQuickNotesForDisplay, quickNoteAriaLabel } from "../lib/quickNoteDisplay.ts";
import { useIsWideScreen } from "../lib/useIsWideScreen.js";
import {
  addQuickNote,
  deleteQuickNote,
  listPinnedQuickNotes,
  listQuickNotesByDate,
  listQuickNotesByRange,
  setQuickNotePinned,
  updateQuickNote,
} from "../lib/quickNotes.ts";
import { readTodoDefaultDestination } from "../lib/settings/todoDefaultDestinationSetting.js";
import { addTask } from "../lib/tasks.js";
import { formatTime, getDateString, isValidDateString } from "../lib/time.ts";
import { copyText } from "../quick-notes/clipboard.ts";
import { pickCurrentDateDivider } from "../quick-notes/currentDate.ts";
import { deleteQuickNotesByIds } from "../quick-notes/deleteQuickNotesByIds.ts";
import { deleteQuickNotesByRange } from "../quick-notes/deleteQuickNotesRange.ts";
import {
  exportQuickNotesJsonByDate,
  exportQuickNotesJsonForNotes,
  quickNotesMarkdown,
} from "../quick-notes/exportQuickNotes.ts";
import { downloadQuickNotesJson, downloadQuickNotesMarkdown } from "../quick-notes/fileDownload.ts";
import HighlightedText from "../quick-notes/HighlightedText.tsx";
import { formatJumpDateLabel } from "../quick-notes/jumpDateLabel.ts";
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
const BUBBLE_HIDE_DELAY_MS = 1200;
const SEARCH_RESULT_PAGE_SIZE = 100;
const SEARCH_FOCUS_HIGHLIGHT_MS = 1500;
const NOTE_CARD_BASE =
  "relative max-w-full [@media(pointer:coarse)]:select-none border px-4 py-2 text-[15px] leading-relaxed text-ink shadow-elev1 outline-none transition hover:border-accent focus-visible:ring-2 focus-visible:ring-accent";
const NOTE_CARD_DEFAULT = "border-border bg-surface/90 hover:bg-surface-hover";
const NOTE_CARD_AGENT = "border-accent/40 bg-accent-soft hover:bg-surface-hover";
const NOTE_CARD_SELECTED = "ring-2 ring-accent";
const NOTE_CARD_LOCATED = "ring-2 ring-inset ring-accent";
const MENU_PANEL_CLASS = "overflow-hidden rounded-card border border-border bg-surface-elevated py-1 shadow-elev2";
const MENU_ITEM_CLASS = "block w-full px-4 py-3 text-left text-sm text-ink-2 transition hover:bg-surface-hover hover:text-ink";

interface MenuTarget {
  note: QuickNote;
  x: number;
  y: number;
}

function normalizeDateParam(value: string | null): string | null {
  if (!value || !isValidDateString(value)) return null;
  return value;
}

function isSoftKeyboardLikelyOpen(): boolean {
  if (typeof window === "undefined") return false;
  const viewport = window.visualViewport;
  if (!viewport || window.innerHeight <= 0) return false;

  const visualViewportBottomGap = window.innerHeight - viewport.height - viewport.offsetTop;
  return visualViewportBottomGap > KEYBOARD_BOTTOM_GAP_THRESHOLD_PX;
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
  const { toast: actionToast, showToast: showActionToast, clearToast: clearActionToast } = useActionToast();
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [composerInsetPx, setComposerInsetPx] = useState(DEFAULT_COMPOSER_INSET_PX);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(SEARCH_RESULT_PAGE_SIZE);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [highlightNoteId, setHighlightNoteId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [bubbleDate, setBubbleDate] = useState<{ label: string; localDate: string } | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [softKeyboardOpen, setSoftKeyboardOpen] = useState(false);
  // 宽屏（≥1024px）回车发送；窄屏（手机）回车交给 textarea 默认换行，靠「记录」按钮发送。
  const isWideScreen = useIsWideScreen();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const composeDraftRef = useRef("");
  const saveTodoPendingRef = useRef(false);
  const punchPendingRef = useRef(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const { deleteEntry } = useEntryMutations();
  const navigate = useNavigate();
  const timeline = useQuickNoteTimeline();
  const unsyncedQuickNoteIds = useUnsyncedQuickNoteIds();
  const pinnedNotes = useLiveQuery(() => listPinnedQuickNotes(), []) ?? [];
  const inputInteractionActive = composerFocused || searchOpen || softKeyboardOpen;
  const navOffsetPx = !isWideScreen && !navHidden ? BOTTOM_NAV_HEIGHT_PX : 0;
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
  const visibleSearchResults = useMemo(() => searchResults.slice(0, searchLimit), [searchResults, searchLimit]);
  const searchDisplayItems = useMemo(
    () => groupQuickNotesForDisplay(visibleSearchResults, { today, order: "desc" }),
    [visibleSearchResults, today],
  );
  const searchHiddenCount = searchResults.length - visibleSearchResults.length;
  const hasQuery = searchTerms.length > 0;
  const hasDraft = draftText.trim().length > 0;
  const jumpDateLabel = formatJumpDateLabel(jumpDate, today);
  const exportMarkdownLabel = jumpDateLabel === "今天" ? "导出今天 Markdown" : `导出 ${jumpDateLabel} Markdown`;
  const exportJsonLabel = jumpDateLabel === "今天" ? "导出今天 JSON" : `导出 ${jumpDateLabel} JSON`;
  const deleteDateLabel = jumpDateLabel === "今天" ? "清理今天" : `清理 ${jumpDateLabel}`;

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
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
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

  useEffect(() => {
    if (!focusNoteId) return;
    if (!timeline.notes.some((note) => note.id === focusNoteId)) return;
    const element = scrollRef.current?.querySelector(`[data-note-id="${focusNoteId}"][role="button"]`);
    if (!(element instanceof HTMLElement)) return;

    element.scrollIntoView({ block: "center" });
    setFocusNoteId(null);
    setHighlightNoteId(focusNoteId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightNoteId(null);
    }, SEARCH_FOCUS_HIGHLIGHT_MS);
  }, [focusNoteId, timeline.notes]);

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

  function closeSearch(options: { resetTimeline?: boolean; preserveQuery?: boolean } = {}) {
    setSearchOpen(false);
    setSearchLimit(SEARCH_RESULT_PAGE_SIZE);
    if (!options.preserveQuery) setSearchQuery("");
    if (options.resetTimeline ?? true) {
      stickBottomRef.current = true;
      setJumpDate(today);
      setSearchParams({});
      void timeline.resetToLatest();
    }
  }

  async function handleResultClick(note: QuickNote) {
    const localDate = getDateString(new Date(note.occurredAt));
    closeSearch({ resetTimeline: false, preserveQuery: true });
    if (note.pinned) {
      setPinnedOpen(true);
      handleJumpDateChange(localDate);
      return;
    }
    setJumpDate(localDate);
    setSearchParams(localDate === today ? {} : { date: localDate });
    stickBottomRef.current = false;
    await timeline.jumpToNote(note);
    setFocusNoteId(note.id);
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

  async function handlePunch() {
    if (punchPendingRef.current) return;
    punchPendingRef.current = true;
    setError(null);
    try {
      const result = await punchNow();
      if (!result.ok) {
        showStatus(result.reason === "no_range" ? "距上次记录还没有时间" : "请先在设置 · 记录偏好选择打点分类");
        return;
      }
      const { entry } = result;
      showActionToast({
        message: `已打点 ${formatTime(entry.startTime)}–${formatTime(entry.endTime)}`,
        actions: [
          { label: "撤销", onClick: () => void handleUndoPunch(entry.id) },
          { label: "去时间轴", onClick: () => navigate(`/?date=${getDateString(new Date(entry.startTime))}`) },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "打点失败");
    } finally {
      punchPendingRef.current = false;
    }
  }

  async function handleUndoPunch(entryId: string) {
    await deleteEntry(entryId);
    clearActionToast();
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
      focusInput();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTodo() {
    const text = draftText.trim();
    if (!text || saving || saveTodoPendingRef.current) return;
    saveTodoPendingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const dest = await readTodoDefaultDestination();
      await addTask({ title: text, toInbox: dest === "inbox" });
      setDraftText("");
      focusInput();
      showActionToast({
        message: dest === "inbox" ? "已放入收件箱" : "已加入今天",
        actions: [{ label: "去待办", onClick: () => navigate("/todo") }],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      saveTodoPendingRef.current = false;
      setSaving(false);
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
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      isWideScreen &&
      !event.nativeEvent.isComposing &&
      event.nativeEvent.keyCode !== 229
    ) {
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
      if (backup.notes.length === 0) {
        showStatus(`${jumpDateLabel} 没有速记，未导出。`);
        return;
      }
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
      const notes = await listQuickNotesByDate(jumpDate);
      if (notes.length === 0) {
        showStatus(`${jumpDateLabel} 没有速记，未导出。`);
        return;
      }
      const markdown = quickNotesMarkdown(`速记 ${jumpDate}`, notes);
      await downloadQuickNotesMarkdown(markdown, jumpDate);
      showStatus(`已导出 ${notes.length} 条速记 Markdown。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function handleDeleteDate() {
    const dayNotes = await listQuickNotesByRange(jumpDate, jumpDate);
    const pinnedCount = dayNotes.filter((note) => note.pinned === true).length;
    const deletableCount = dayNotes.length - pinnedCount;
    if (deletableCount === 0) {
      showStatus(`${jumpDateLabel} 没有可清理的速记。`);
      return;
    }

    const confirmed = await confirm({
      title: `删除 ${jumpDateLabel} 的速记？`,
      body: (
        <div className="space-y-1">
          {jumpDate !== today && <p className="font-medium text-danger">这不是今天，你正要删除 {jumpDateLabel}（{jumpDate}）的记录。</p>}
          <p>
            将删除 <strong>{deletableCount}</strong> 条速记
            {pinnedCount > 0 ? `（另有 ${pinnedCount} 条置顶会保留）` : ""}，不影响时间记录。
          </p>
          <p>建议先导出需要保留的内容。</p>
        </div>
      ),
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!confirmed) return;

    const result = await deleteQuickNotesByRange(jumpDate, jumpDate);
    showStatus(`已删除 ${result.deleted} 条速记。`);
  }

  function noteInteractionProps(note: QuickNote) {
    return {
      onClick: selectionMode ? () => toggleSelected(note.id) : undefined,
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        // 选择态下点气泡内的链接只做勾选，不跳转到浏览器。
        if (selectionMode && event.target instanceof Element && event.target.closest("a")) {
          event.preventDefault();
        }
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // 焦点在内部链接/展开按钮上时，保留它们自身的键盘行为。
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (selectionMode) {
          toggleSelected(note.id);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        pressedNoteRef.current = note;
        setMenu({ note, x: rect.left, y: rect.bottom });
      },
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
        // 桌面存在文字选区时，让浏览器原生右键菜单（复制 / 复制链接地址）可用。
        const selection = typeof window !== "undefined" ? (window.getSelection()?.toString().trim() ?? "") : "";
        if (selection.length > 0) return;
        pressedNoteRef.current = note;
        longPress.onContextMenu(event);
      },
    };
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-page text-ink">
      <header className="sticky top-0 z-[var(--z-dropdown)] shrink-0 border-b border-border bg-page/95 px-4 pb-2 pt-3 backdrop-blur sm:pb-3 sm:pt-4 sm:shadow-elev1">
        {selectionMode ? (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
            <button
              type="button"
              aria-label="退出多选"
              onClick={exitSelection}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-2"
            >
              <Icon icon={X} size={16} />
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              已选 <span className="td-num">{selectedIds.size}</span> 条
            </span>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchCopy()}
              className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-ink-2 disabled:cursor-not-allowed disabled:text-ink-3"
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
                className="rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-ink-2 disabled:cursor-not-allowed disabled:text-ink-3"
              >
                导出
              </button>
              {exportMenuOpen && (
                <>
                  <div role="presentation" className="fixed inset-0 z-[var(--z-backdrop)]" onClick={() => setExportMenuOpen(false)} />
                  <div
                    role="menu"
                    className={`absolute right-0 z-[var(--z-modal)] mt-2 w-40 ${MENU_PANEL_CLASS}`}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setExportMenuOpen(false);
                        void handleBatchExportMarkdown();
                      }}
                      className={MENU_ITEM_CLASS}
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
                      className={MENU_ITEM_CLASS}
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
              className="rounded-xl border border-danger/40 bg-danger-soft px-3 py-1.5 text-sm font-medium text-danger disabled:cursor-not-allowed disabled:text-ink-3"
            >
              删除
            </button>
          </div>
        ) : searchOpen ? (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
            <Icon icon={MagnifyingGlass} size={16} className="text-ink-3" />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="搜索速记"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchLimit(SEARCH_RESULT_PAGE_SIZE);
              }}
              placeholder="搜索速记…"
              className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 outline-none"
            />
            <button
              type="button"
              aria-label="退出搜索"
              onClick={() => closeSearch()}
              className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-ink-2 transition hover:text-ink"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              {!timeline.atLatest && (
                <span className="rounded-full border border-border-strong bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-3">
                  历史
                </span>
              )}
            </div>
            <label className="flex items-center gap-1 rounded-xl border border-border bg-surface px-2 py-1 text-right shadow-sm sm:rounded-card sm:px-3 sm:py-2">
              <span className="hidden text-[11px] text-ink-3 sm:block">日期</span>
              <input
                ref={dateInputRef}
                type="date"
                aria-label="跳转日期"
                value={jumpDate}
                onChange={(event) => handleJumpDateChange(event.target.value)}
                className="td-time w-[7.5rem] bg-transparent text-xs font-medium text-ink outline-none [color-scheme:dark] sm:mt-0.5 sm:w-36 sm:text-sm"
              />
            </label>

            <Link
              to="/diary"
              aria-label="日记"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink sm:size-11"
            >
              <Icon icon={Notebook} size={16} />
            </Link>

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
                className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink sm:size-11"
              >
                <Icon icon={PushPin} size={16} />
                <span className="td-num absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold leading-5 text-page">
                  {pinnedNotes.length}
                </span>
              </button>
            )}

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
                className="flex size-9 items-center justify-center rounded-full border border-border bg-surface text-lg leading-none text-ink-2 transition hover:border-accent hover:text-ink sm:size-11"
              >
                <Icon icon={DotsThree} size={20} />
              </button>
              {actionsOpen && (
                <>
                  <div
                    role="presentation"
                    className="fixed inset-0 z-[var(--z-backdrop)]"
                    onClick={() => setActionsOpen(false)}
                  />
                  <div
                    role="menu"
                    aria-label="速记导出与清理"
                    className={`absolute right-0 z-[var(--z-modal)] mt-2 w-48 ${MENU_PANEL_CLASS}`}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        void handleExportMarkdown();
                      }}
                      className={MENU_ITEM_CLASS}
                    >
                      {exportMarkdownLabel}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        void handleExportJson();
                      }}
                      className={MENU_ITEM_CLASS}
                    >
                      {exportJsonLabel}
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionsOpen(false);
                        void handleDeleteDate();
                      }}
                      className="block w-full px-4 py-3 text-left text-sm font-medium text-danger transition hover:bg-danger-soft"
                    >
                      {deleteDateLabel}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {!selectionMode && !searchOpen && pinnedOpen && pinnedNotes.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[var(--z-modal)] px-4">
            <section
              aria-label="置顶速记"
              className="mx-auto flex max-h-[min(52vh,24rem)] w-full max-w-3xl flex-col gap-2 overflow-y-auto rounded-card border border-border bg-surface p-3 shadow-elev2"
            >
              <p className="px-1 text-xs font-semibold text-ink-3">
                置顶 · <span className="td-num">{pinnedNotes.length}</span>
              </p>
              {pinnedNotes.map((note) => {
                const isAgentNote = note.source === "agent";
                const selected = selectedIds.has(note.id);
                const pending = unsyncedQuickNoteIds.has(note.id);
                return (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    aria-label={quickNoteAriaLabel(note)}
                    aria-pressed={selectionMode ? selected : undefined}
                    {...noteInteractionProps(note)}
                    style={{ WebkitTouchCallout: "none" }}
                    className={`${NOTE_CARD_BASE} rounded-xl text-sm ${isAgentNote ? NOTE_CARD_AGENT : "border-border bg-page/70"} ${
                      selected ? NOTE_CARD_SELECTED : ""
                    }`}
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
              <div className="rounded-card border border-dashed border-border bg-surface/45 px-5 py-10 text-center text-sm text-ink-3">
                输入关键词搜索速记，空格分隔多个词表示同时包含。
              </div>
            ) : searchResults.length === 0 ? (
              <div className="rounded-card border border-dashed border-border bg-surface/45 px-5 py-10 text-center text-sm text-ink-3">
                没有匹配的速记
              </div>
            ) : (
              <>
                {searchDisplayItems.map((item) => {
                  if (item.type === "date") {
                    return (
                      <div key={item.key} data-search-date={item.localDate} className="flex items-center gap-3 pt-1">
                        <div className="h-px flex-1 bg-border" />
                        <div className="rounded-full border border-border bg-surface px-3 py-1 td-text-caption font-medium text-ink-3">
                          {item.label}
                        </div>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                    );
                  }

                  const note = item.note;
                  const isAgentNote = note.source === "agent";
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-note-id={note.id}
                      onClick={() => void handleResultClick(note)}
                      className={`w-full text-left ${NOTE_CARD_BASE} rounded-card ${isAgentNote ? NOTE_CARD_AGENT : NOTE_CARD_DEFAULT}`}
                    >
                      <time className="td-time float-right ml-2 text-[11px] text-ink-3">
                        {formatLocalClock(note.occurredAt)}
                      </time>
                      {isAgentNote && (
                        <div className="mb-1 text-[11px] font-semibold text-accent-ink">
                          {note.sourceLabel ?? "助手"}
                        </div>
                      )}
                      <HighlightedText text={note.text} terms={searchTerms} />
                    </button>
                  );
                })}
                {searchHiddenCount > 0 && (
                  <div className="flex justify-center pb-1">
                    <button
                      type="button"
                      aria-label="加载更多搜索结果"
                      onClick={() => setSearchLimit((limit) => limit + SEARCH_RESULT_PAGE_SIZE)}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 td-text-caption font-medium text-ink-3 transition hover:border-accent hover:text-ink-2"
                    >
                      加载更多（还有 {searchHiddenCount} 条）
                    </button>
                  </div>
                )}
              </>
            )
          ) : (
            <>
              {timeline.hasOlder && (
                <div className="flex justify-center pb-1">
                  <button
                    type="button"
                    onClick={() => void timeline.loadOlder()}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 td-text-caption font-medium text-ink-3 transition hover:border-accent hover:text-ink-2"
                  >
                    加载更早
                  </button>
                </div>
              )}

              {timeline.loading && (
                <div className="rounded-card border border-border bg-surface/60 px-4 py-8 text-center text-sm text-ink-3">
                  正在读取速记...
                </div>
              )}

              {!timeline.loading && displayItems.length === 0 && pinnedNotes.length === 0 && (
                <div className="rounded-card border border-dashed border-border bg-surface/45 px-5 py-10 text-center">
                  <p className="text-sm font-medium text-ink-2">还没有速记</p>
                  <p className="mt-1 text-xs text-ink-3">写下一个想法、线索或待办，稍后再回来看。</p>
                </div>
              )}

              {displayItems.map((item) => {
                if (item.type === "date") {
                  return (
                    <div key={item.key} data-date-label={item.label} data-local-date={item.localDate} className="flex items-center gap-3 pt-1">
                      <div className="h-px flex-1 bg-border" />
                      <div className="rounded-full border border-border bg-surface px-3 py-1 td-text-caption font-medium text-ink-3">
                        {item.label}
                      </div>
                      <div className="h-px flex-1 bg-border" />
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
                      data-note-id={note.id}
                      aria-label={quickNoteAriaLabel(note)}
                      aria-pressed={selectionMode ? selected : undefined}
                      {...noteInteractionProps(note)}
                      style={{ WebkitTouchCallout: "none" }}
                      className={`${NOTE_CARD_BASE} rounded-card ${isAgentNote ? NOTE_CARD_AGENT : NOTE_CARD_DEFAULT} ${
                        selected ? NOTE_CARD_SELECTED : ""
                      } ${highlightNoteId === note.id ? NOTE_CARD_LOCATED : ""}`}
                    >
                      {selectionMode && (
                        <span
                          aria-hidden="true"
                          className={`absolute right-2 top-2 flex size-5 items-center justify-center rounded-full border text-[11px] ${
                            selected
                              ? "border-accent bg-accent text-page"
                              : "border-border-strong bg-page/60 text-transparent"
                          }`}
                        >
                          <Icon icon={Check} size={14} />
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
          className={`fixed left-1/2 top-[4.75rem] z-[var(--z-dropdown)] -translate-x-1/2 rounded-full border border-border-strong bg-surface/90 px-3 py-1 text-xs font-medium text-ink-2 shadow-elev1 backdrop-blur transition-opacity duration-300 sm:top-20 ${
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
            setJumpDate(today);
            setSearchParams({});
            stickBottomRef.current = true;
            setAtBottom(true);
            if (!timeline.atLatest) {
              void timeline.resetToLatest();
              return;
            }
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="fixed right-4 rounded-full border border-border-strong bg-surface px-3 py-2 text-xs font-medium text-ink-2 shadow-elev1 transition hover:border-accent hover:text-ink"
          style={{ bottom: navOffsetPx + bottomInsetPx }}
        >
          <span className="inline-flex items-center gap-1">
            <Icon icon={ArrowDown} size={14} />
            <span>最新</span>
          </span>
        </button>
      )}

      {error && (
        <p
          className="fixed left-4 right-4 mx-auto max-w-3xl rounded-card border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger shadow-elev1"
          style={{ bottom: navOffsetPx + bottomInsetPx }}
        >
          {error}
        </p>
      )}
      {status && (
        <p
          className="fixed left-4 right-4 mx-auto max-w-3xl rounded-card border border-border bg-surface/95 px-3 py-2 text-sm text-ink-2 shadow-elev1"
          style={{ bottom: navOffsetPx + bottomInsetPx }}
        >
          {status}
        </p>
      )}
      {!searchOpen && !selectionMode && (
        <form
          ref={composerRef}
          aria-label="速记输入区"
          className="fixed left-0 right-0 border-t border-border bg-page/95 p-2 shadow-elev2 backdrop-blur transition-[bottom] duration-200 sm:p-3"
          style={{ bottom: navOffsetPx }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="mx-auto w-full max-w-3xl">
            <ActionToastBar
              toast={actionToast}
              onDismiss={clearActionToast}
              ariaLabel="捕捉操作反馈"
              className="mb-2"
            />
            {editingId && (
              <div className="mb-2 flex items-center justify-between rounded-card border border-accent/20 bg-accent-soft px-3 py-2 text-xs text-accent-ink">
                <span className="truncate">正在编辑：{draftText.slice(0, 40)}</span>
                <button
                  type="button"
                  aria-label="取消编辑"
                  onClick={cancelEditing}
                  className="ml-2 inline-flex text-accent-ink"
                >
                  <Icon icon={X} size={16} />
                </button>
              </div>
            )}
            <div className="rounded-card border border-border bg-surface/90 p-1.5 shadow-sm sm:rounded-card sm:p-2">
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  aria-label={editingId ? "取消编辑" : hasDraft ? "存为待办" : "搜索速记"}
                  disabled={saving}
                  onClick={() => {
                    if (editingId) {
                      cancelEditing();
                      return;
                    }
                    if (hasDraft) {
                      void handleSaveTodo();
                      return;
                    }
                    openSearch();
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-card border border-border-strong text-ink-2 transition hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:border-border disabled:text-ink-3"
                >
                  {editingId ? (
                    <Icon icon={X} size={18} />
                  ) : hasDraft ? (
                    <Icon icon={Plus} size={18} />
                  ) : (
                    <Icon icon={MagnifyingGlass} size={18} />
                  )}
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
                  className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-base leading-relaxed text-ink placeholder:text-ink-3 outline-none"
                />
                <button
                  type={editingId || hasDraft ? "submit" : "button"}
                  aria-label={editingId ? "保存速记" : hasDraft ? "记录速记" : "打点（记录到现在）"}
                  disabled={saving}
                  onClick={(event) => {
                    if (editingId || hasDraft) return;
                    event.preventDefault();
                    void handlePunch();
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-card bg-accent text-page transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-ink-3"
                >
                  {editingId ? (
                    <Icon icon={Check} size={19} weight="bold" />
                  ) : hasDraft ? (
                    <Icon icon={NotePencil} size={19} />
                  ) : (
                    <Icon icon={Timer} size={19} />
                  )}
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
