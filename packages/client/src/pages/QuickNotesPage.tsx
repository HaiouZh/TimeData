import {
  ArrowDown,
  BookOpen,
  Check,
  Crosshair,
  DotsThree,
  MagnifyingGlass,
  NotePencil,
  Plus,
  PushPin,
  Timer,
  X,
} from "@phosphor-icons/react";
import { localDateTimeToUtc, type QuickNote } from "@timedata/shared";
import { useLiveQuery } from "dexie-react-hooks";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Icon } from "../components/Icon.js";
import { ActionToastBar } from "../components/ui/ActionToastBar.tsx";
import { DateField } from "../components/ui/DateField.js";
import { EmptyState } from "../components/ui/EmptyState.js";
import { LoadingState } from "../components/ui/LoadingState.js";
import { BOTTOM_NAV_HEIGHT_PX, useBottomNav } from "../contexts/BottomNavContext.tsx";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { useDebouncedValue } from "../hooks/useDebouncedValue.ts";
import { useActionToast } from "../hooks/useActionToast.ts";
import { useEntryMutations } from "../hooks/useEntries.js";
import { useKeyboardHeight } from "../hooks/useKeyboardHeight.ts";
import { useLongPress } from "../hooks/useLongPress.ts";
import { composeBottomInset } from "../lib/bottomInset.ts";
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
import { addTask, deleteTask } from "../lib/tasks.js";
import { formatTime, getDateString, isValidDateString } from "../lib/time.ts";
import { copyText } from "../quick-notes/clipboard.ts";
import { clearComposerDraft, isEditDraftDirty, readComposerDraft, writeComposerDraft } from "../quick-notes/composerDraft.ts";
import { findStuckDivider } from "../quick-notes/currentDate.ts";
import { groupDisplayItemsByDay } from "../quick-notes/dayGroups.ts";
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
const STATUS_AUTO_DISMISS_MS = 2400;
const STUCK_HIDE_DELAY_MS = 1200;
// 与 JSX 上的 top-2（0.5rem）是同一个值：日期条粘住时距滚动容器可视区顶部的像素。
const STICKY_TOP_PX = 8;
const SEARCH_RESULT_PAGE_SIZE = 100;
const SEARCH_FOCUS_HIGHLIGHT_MS = 1500;
// 草稿落盘的防抖窗口：停顿超过这个时长才落盘，连续不停打字（键间隔 < 400ms）期间一次都不落盘，
// 不做每字一写。此时若被杀/刷新，丢的是整条草稿，不只是最后几个字——实际风险低，因为切页/
// 后台化天然带来 >400ms 的停顿，但不要误读成「压到最后几个字才可能丢」。
const COMPOSER_DRAFT_DEBOUNCE_MS = 400;
const NOTE_CARD_BASE =
  "relative max-w-full [@media(pointer:coarse)]:select-none border px-4 py-2 td-text-body text-ink shadow-elev1 outline-none transition hover:border-accent focus-visible:ring-2 focus-visible:ring-accent";
const NOTE_CARD_DEFAULT = "border-border bg-surface/90 hover:bg-surface-hover";
const NOTE_CARD_AGENT = "border-accent/40 bg-accent-soft hover:bg-surface-hover";
const NOTE_CARD_SELECTED = "ring-2 ring-accent";
const NOTE_CARD_LOCATED = "ring-2 ring-inset ring-accent";
const MENU_PANEL_CLASS = "overflow-hidden rounded-card border border-border bg-surface-elevated py-1 shadow-elev2";
const MENU_ITEM_CLASS = "block w-full px-4 py-3 text-left td-text-label text-ink-2 transition hover:bg-surface-hover hover:text-ink";

interface MenuTarget {
  note: QuickNote;
  x: number;
  y: number;
}

function normalizeDateParam(value: string | null): string | null {
  if (!value || !isValidDateString(value)) return null;
  return value;
}

export default function QuickNotesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getDateString(new Date());
  const queryDate = normalizeDateParam(searchParams.get("date"));
  // 「你眼前正在看的那天」——由停手扫描更新，导出/清理的唯一目标。
  // 刻意不让它写 URL：跟着滚动写 ?date= 会把浏览历史刷爆。
  // URL 同步由各跳转点直接调 setSearchParams 承担，深链初始跳转由 queryDate + didInitJumpRef 承担。
  const [viewingDate, setViewingDate] = useState(queryDate ?? today);
  const [draftText, setDraftText] = useState(() => readComposerDraft());
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
  // 日历开着时不能让日期条隐身，否则月历悬在半空、它的锚点已经不见了。
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // 日期跳转的落点定位请求：jumpToDate 只换数据窗口、不动 scrollTop，由专门的 effect 消费。
  const [pendingJumpSeq, setPendingJumpSeq] = useState(0);
  const pendingJumpRef = useRef<{ localDate: string; utcStart: string } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  // 宽屏（≥1024px）回车发送；窄屏（手机）回车交给 textarea 默认换行，靠「记录」按钮发送。
  const isWideScreen = useIsWideScreen();
  const keyboardHeight = useKeyboardHeight();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composeDraftRef = useRef("");
  // 进入编辑时快照被编辑那条的原文，用来判「用户改过没」。
  // 故意用进入编辑时的快照而不是当前库里的值：编辑期间那条被另一台设备改了而用户没动，
  // 判定为「没改过」静默切换是对的——用户没有东西可丢。
  const editingOriginalRef = useRef("");
  // toast 的 onClick 捕获的是「创建 toast 那次渲染」的闭包，直接读 draftText 会读到提交前那份
  // （非空），于是「输入框已有内容就不覆盖」永远为真、永远不回填。经这个 ref 读最新值。
  const draftTextRef = useRef(draftText);
  useEffect(() => {
    draftTextRef.current = draftText;
  }, [draftText]);
  // 同上：toast 的 onClick 闭包同样冻结 editingId，创建 toast 那次渲染时必为 null（存待办只在
  // 非编辑态可达）。撤销要判「此刻是不是正在编辑另一条」，只能靠这个随渲染同步的 ref 读最新值。
  const editingIdRef = useRef(editingId);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);
  const saveTodoPendingRef = useRef(false);
  const punchPendingRef = useRef(false);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 当前被打上隐身类的日期条。滚动一开始就要摘掉它，粘住那条才会随 transition 淡入。
  const stuckElRef = useRef<HTMLElement | null>(null);
  // 停手定时器的回调捕获的是「创建定时器那一次渲染」的闭包：用户在那 1.2 秒内打开日历、
  // 进多选或开搜索，回调里读到的仍是旧值，照样会打上隐身类——日历失去锚点、「选中这天」
  // 被藏掉。同 draftTextRef / editingIdRef 的老问题，经这个随渲染同步的 ref 读最新值。
  const scanGuardRef = useRef({ datePickerOpen, selectionMode, searchOpen });
  useEffect(() => {
    scanGuardRef.current = { datePickerOpen, selectionMode, searchOpen };
  }, [datePickerOpen, selectionMode, searchOpen]);
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
  const inputInteractionActive = composerFocused || searchOpen || keyboardHeight > 0;
  const navOffsetPx = !isWideScreen && !navHidden ? BOTTOM_NAV_HEIGHT_PX : 0;
  const bottomInsetPx = selectionMode || searchOpen ? COMPOSER_BOTTOM_GAP_PX : composerInsetPx;
  // 底部避让量单一合成来源（composeBottomInset，见 lib/bottomInset.ts）：bottomInsetPx/navOffsetPx
  // 仍是本页私有的「此刻底部站着谁」判断，这里只把它们的结果连同键盘高一起喂进合成，
  // keyboardHeightPx=0（桌面浏览器 / 键盘收起）时逐值等于合成前的批 1 值，见该文件回归护栏测试。
  // 内容留白：原口径只有 bottomInsetPx（不含 navOffsetPx），故 navOffsetPx 传 0，只加键盘高。
  const contentBottomInsetPx = composeBottomInset({ barHeightPx: bottomInsetPx, navOffsetPx: 0, keyboardHeightPx: keyboardHeight });
  // 贴 composer 上沿的浮层（跳到最新按钮 / 错误 / 状态提示）：原口径 navOffsetPx + bottomInsetPx。
  const floatBottomInsetPx = composeBottomInset({ barHeightPx: bottomInsetPx, navOffsetPx, keyboardHeightPx: keyboardHeight });
  // composer 输入条自身：原口径只有 navOffsetPx（自身高度已在 bottomInsetPx 里量过，不重复计入）。
  // 它就是用户敲字的那条框，键盘弹起时必须浮到键盘之上才可用，故加键盘高。
  const composerBarBottomPx = composeBottomInset({ barHeightPx: 0, navOffsetPx, keyboardHeightPx: keyboardHeight });
  const displayItems = useMemo(
    () => groupQuickNotesForDisplay(timeline.notes.filter((note) => !note.pinned), { today }),
    [timeline.notes, today],
  );
  // 渲染吃的是按天折过的结构而不是扁平数组：每天必须各自成一个 sticky 包含块，理由见 dayGroups.ts。
  const dayGroups = useMemo(() => groupDisplayItemsByDay(displayItems), [displayItems]);
  const selectableNotes = useMemo(() => {
    const byId = new Map<string, QuickNote>();
    for (const note of timeline.notes) byId.set(note.id, note);
    for (const note of pinnedNotes) byId.set(note.id, note);
    return [...byId.values()];
  }, [timeline.notes, pinnedNotes]);
  // 全选/按日选只吃主列表已加载的非置顶速记：置顶不进全选，避免「全选→删除」隔着
  // 关闭的浮层删掉看不见的置顶（与「清理跳过置顶」同一保护口径，QN-02/QN-11）。
  const loadedUnpinnedIds = useMemo(
    () => timeline.notes.filter((note) => !note.pinned).map((note) => note.id),
    [timeline.notes],
  );
  const noteIdsByLocalDate = useMemo(() => {
    const map = new Map<string, string[]>();
    let currentDate: string | null = null;
    for (const item of displayItems) {
      if (item.type === "date") {
        currentDate = item.localDate;
        continue;
      }
      if (!currentDate) continue;
      const ids = map.get(currentDate) ?? [];
      ids.push(item.note.id);
      map.set(currentDate, ids);
    }
    return map;
  }, [displayItems]);
  const allLoadedSelected =
    loadedUnpinnedIds.length > 0 && loadedUnpinnedIds.every((id) => selectedIds.has(id));
  const selectedPinnedCount = pinnedNotes.reduce(
    (count, note) => (selectedIds.has(note.id) ? count + 1 : count),
    0,
  );
  const debouncedQuery = useDebouncedValue(searchQuery, 200);
  const searchTerms = useMemo(() => parseSearchTerms(debouncedQuery), [debouncedQuery]);
  const searchResults = useLiveQuery(() => searchQuickNotes(debouncedQuery), [debouncedQuery]) ?? [];
  const visibleSearchResults = useMemo(() => searchResults.slice(0, searchLimit), [searchResults, searchLimit]);
  const searchDisplayItems = useMemo(
    () => groupQuickNotesForDisplay(visibleSearchResults, { today, order: "desc" }),
    [visibleSearchResults, today],
  );
  const searchDayGroups = useMemo(() => groupDisplayItemsByDay(searchDisplayItems), [searchDisplayItems]);
  const searchHiddenCount = searchResults.length - visibleSearchResults.length;
  const hasQuery = searchTerms.length > 0;
  const hasDraft = draftText.trim().length > 0;
  // 防抖的输入恒为「compose 草稿」而不是 draftText。编辑态下 draftText 是被编辑速记的正文，
  // 若改成「防抖 draftText + effect 里判编辑态跳过」，退出编辑那一刻 editingId 已变 null、
  // effect 立即放行，而防抖值还停在速记正文上，正文就被写成了草稿。让输入本身永远是 compose
  // 草稿，这个时序陷阱从根上不存在，effect 里也不必再判编辑态。
  const composeDraft = editingId ? composeDraftRef.current : draftText;
  const debouncedComposeDraft = useDebouncedValue(composeDraft, COMPOSER_DRAFT_DEBOUNCE_MS);
  useEffect(() => {
    writeComposerDraft(debouncedComposeDraft);
  }, [debouncedComposeDraft]);
  // 恢复来的草稿要说一声。定时器共用 statusTimerRef，这样后续 showStatus 能正确顶替它。
  useEffect(() => {
    if (readComposerDraft() === "") return;
    setStatus("已恢复未发出的草稿");
    const timer = setTimeout(() => {
      statusTimerRef.current = null;
      setStatus(null);
    }, STATUS_AUTO_DISMISS_MS);
    statusTimerRef.current = timer;
    // StrictMode 下这个 effect 会挂载两次：清理时只清自己种下的那个定时器（闭包里的
    // timer），不读 statusTimerRef.current——它此刻可能已经被第二次挂载或后续 showStatus 顶替。
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const viewingDateLabel = formatJumpDateLabel(viewingDate, today);
  const exportMarkdownLabel = viewingDateLabel === "今天" ? "导出今天 Markdown" : `导出 ${viewingDateLabel} Markdown`;
  const exportJsonLabel = viewingDateLabel === "今天" ? "导出今天 JSON" : `导出 ${viewingDateLabel} JSON`;
  const deleteDateLabel = viewingDateLabel === "今天" ? "清理今天" : `清理 ${viewingDateLabel}`;

  const longPress = useLongPress(({ x, y }) => {
    const note = pressedNoteRef.current;
    if (note) setMenu({ note, x, y });
  });

  useEffect(() => {
    if (didInitJumpRef.current) return;
    didInitJumpRef.current = true;
    if (queryDate) void timeline.jumpToDate(queryDate);
  }, [queryDate, timeline.jumpToDate]);

  useEffect(
    () => () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
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

  // 多选与搜索互斥；置顶浮层在多选态保留（QN-09「通」：选中的置顶必须可见可反选）。
  useEffect(() => {
    if (selectionMode) {
      setSearchOpen(false);
    }
  }, [selectionMode]);

  // 进多选 / 开搜索 / 开置顶浮层时列表 DOM 会整块换掉，隐身 ref 会指向孤儿节点：不清则下次
  // remove 打空，真正粘住那条永远摘不掉 .stuck 类，表现为滚动时日期条再也不出现。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 这三个是触发器不是读取值——模式切换时列表 DOM 整块换掉，stuckElRef 会指向孤儿节点，必须重跑清类
  useEffect(() => {
    clearStuckDivider();
  }, [selectionMode, searchOpen, pinnedOpen]);

  // header 更多操作 / 导出菜单开着时 Escape 可关（QN-16）。气泡操作菜单的 Escape
  // 在 QuickNoteActionMenu 内部处理，这里只管这两个内联菜单。
  useEffect(() => {
    if (!actionsOpen && !exportMenuOpen) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActionsOpen(false);
      setExportMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actionsOpen, exportMenuOpen]);

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

  // 日期跳转的落点定位：jumpToDate 只换数据窗口，浏览器会把 scrollTop 留在旧像素高度上，
  // 视口就停在新列表的随机位置（用户反馈「不知道跳哪去了」）。等窗口起点抵达目标日
  // （notes[0] >= 目标日 00:00，「跳更早」时旧数据即满足、先落顶等新数据顶替，结果一致）后：
  // 目标日分隔条存在就滚它贴顶；当天没有速记则回列表顶——顶部就是目标日之后最近的内容。
  // biome-ignore lint/correctness/useExhaustiveDependencies: pendingJumpSeq 是触发器——「跳更早」时 notes 引用不变，靠它让 effect 立即跑一次
  useEffect(() => {
    const pending = pendingJumpRef.current;
    if (!pending) return;
    if (timeline.notes.length > 0 && timeline.notes[0].occurredAt < pending.utcStart) return;
    pendingJumpRef.current = null;
    const el = scrollRef.current;
    if (!el) return;
    const divider = el.querySelector(`[data-local-date="${pending.localDate}"]`);
    if (divider instanceof HTMLElement) divider.scrollIntoView({ block: "start" });
    else el.scrollTop = 0;
  }, [pendingJumpSeq, timeline.notes]);

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

    clearStuckDivider();
    if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current);
    stuckTimerRef.current = setTimeout(() => {
      stuckTimerRef.current = null;
      scanStuckDivider();
    }, STUCK_HIDE_DELAY_MS);
  }

  // 停止滚动后跑一次：给粘在顶上那条打隐身类，避免它与列表里同一条日期重影。
  // 只在这一刻扫描（而不是每帧），滚动全程零 JS —— 粘住效果由 CSS sticky 独自承担。
  function scanStuckDivider() {
    const el = scrollRef.current;
    if (!el) return;
    // 一律经 ref 读，别直接读 state——见 scanGuardRef 的注释。
    const { datePickerOpen: pickerOpen, selectionMode: selecting, searchOpen: searching } = scanGuardRef.current;
    // 日历开着时隐身会让月历失去锚点；多选态隐身会让「选中这天」点不到。
    if (pickerOpen || selecting) return;

    const containerTop = el.getBoundingClientRect().top;
    const nodes = Array.from(
      el.querySelectorAll<HTMLElement>(searching ? "[data-search-date]" : "[data-date-label]"),
    );
    const candidates = nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        node,
        localDate: node.dataset.localDate ?? node.dataset.searchDate ?? today,
        top: rect.top - containerTop,
        height: rect.height,
      };
    });

    const stuck = findStuckDivider(candidates, STICKY_TOP_PX);
    if (!stuck) return;
    stuck.node.classList.add("stuck");
    stuckElRef.current = stuck.node;
    // 搜索态不更新：导出/清理在搜索态不可达，跟着搜索结果乱跳只会在退出搜索后留下错的目标日。
    // 用上面从 scanGuardRef 解构出的 searching，不是 state 上的 searchOpen。
    if (!searching) setViewingDate(stuck.localDate);
  }

  function clearStuckDivider() {
    if (!stuckElRef.current) return;
    stuckElRef.current.classList.remove("stuck");
    stuckElRef.current = null;
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
      pendingJumpRef.current = null;
      setViewingDate(today);
      setSearchParams({});
      void timeline.resetToLatest();
    }
  }

  // 「回到最新」的唯一实现：浮标按钮与历史视图保存后的 toast 共用，避免两处各写一遍。
  function jumpToLatest() {
    setViewingDate(today);
    setSearchParams({});
    stickBottomRef.current = true;
    pendingJumpRef.current = null;
    setAtBottom(true);
    if (!timeline.atLatest) {
      void timeline.resetToLatest();
      return;
    }
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function handleResultClick(note: QuickNote) {
    const localDate = getDateString(new Date(note.occurredAt));
    closeSearch({ resetTimeline: false, preserveQuery: true });
    if (note.pinned) {
      setPinnedOpen(true);
      handleJumpDateChange(localDate);
      return;
    }
    setViewingDate(localDate);
    setSearchParams(localDate === today ? {} : { date: localDate });
    stickBottomRef.current = false;
    // 定位交给 focusNoteId 的 scrollIntoView，别让残留的日期定位请求抢滚动。
    pendingJumpRef.current = null;
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
        editingOriginalRef.current = "";
      } else {
        await addQuickNote(text);
        setDraftText("");
        clearComposerDraft();
        stickBottomRef.current = true;
        // 历史窗口下新速记落在窗口之外、气泡不出现，吸底滚动也被 atLatest 挡住。
        // 不给事件反馈的话页面零变化，用户会以为没存上而重发。
        if (!timeline.atLatest) {
          showActionToast({
            message: "已记录",
            actions: [{ label: "回到最新", onClick: jumpToLatest }],
          });
        }
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
      const task = await addTask({ title: text, toInbox: dest === "inbox" });
      setDraftText("");
      clearComposerDraft();
      focusInput();
      showActionToast({
        message: dest === "inbox" ? "已放入收件箱" : "已加入今天",
        actions: [
          { label: "撤销", onClick: () => void handleUndoSaveTodo(task.id, text) },
          { label: "去待办", onClick: () => navigate("/todo") },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      saveTodoPendingRef.current = false;
      setSaving(false);
    }
  }

  async function handleUndoSaveTodo(taskId: string, text: string) {
    // toast 活 6 秒，期间用户可能已进编辑态。此刻回填会把待办正文写进被编辑速记的输入缓冲，
    // 保存就静默替换了那条速记的正文——所以在删任务之前就拒绝，别造成“任务删了、正文也没了”。
    if (editingIdRef.current) {
      showStatus("正在编辑速记，先退出编辑再撤销这条待办");
      return;
    }
    await deleteTask(taskId);
    clearActionToast();
    // 撤销窗口里用户可能已经开始打新草稿：覆盖手上的输入比少一次回填更坏。
    if (draftTextRef.current.trim()) {
      showStatus("已删除该待办，原文本未回填（输入框已有内容）");
      return;
    }
    setDraftText(text);
    // 清盘（handleSaveTodo 的 clearComposerDraft）是同步的，回填也要同步落盘对称：
    // 否则防抖窗口内清空再回填到同一个值，debouncedComposeDraft 从未真的变过（Object.is
    // bail-out），写盘 effect 永远不会再跑，localStorage 就永久停在被清掉的那次。
    writeComposerDraft(text);
    focusInput();
  }

  async function startEditing(note: QuickNote) {
    if (editingId && isEditDraftDirty(draftText, editingOriginalRef.current)) {
      const confirmed = await confirm({
        title: "放弃对上一条的修改？",
        body: "你对上一条速记的修改还没保存，切去编辑另一条会丢掉它。",
        confirmLabel: "放弃修改",
        cancelLabel: "继续编辑",
        danger: true,
      });
      if (!confirmed) return;
    }
    if (!editingId) composeDraftRef.current = draftText;
    editingOriginalRef.current = note.text;
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
    editingOriginalRef.current = "";
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
    // 不关置顶浮层：从置顶长按进多选时，被选中的那条要留在眼前（QN-09）。
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

  /** 全选当前已加载（非置顶）；已全在集合则反选，但保留单独勾选的置顶。 */
  function toggleSelectAllLoaded() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (loadedUnpinnedIds.every((id) => next.has(id))) {
        for (const id of loadedUnpinnedIds) next.delete(id);
      } else {
        for (const id of loadedUnpinnedIds) next.add(id);
      }
      return next;
    });
  }

  /** 选中某天已加载的全部速记；已全在集合则反选。 */
  function toggleSelectDay(localDate: string) {
    const ids = noteIdsByLocalDate.get(localDate) ?? [];
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (ids.every((id) => next.has(id))) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
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
    setViewingDate(nextDate);
    setSearchParams(nextDate === today ? {} : { date: nextDate });
    stickBottomRef.current = false;
    pendingJumpRef.current = { localDate: nextDate, utcStart: localDateTimeToUtc(`${nextDate}T00:00:00`) };
    setPendingJumpSeq((seq) => seq + 1);
    void timeline.jumpToDate(nextDate);
  }

  async function handleExportJson() {
    setError(null);
    setStatus(null);
    try {
      const backup = await exportQuickNotesJsonByDate(viewingDate);
      if (backup.notes.length === 0) {
        showStatus(`${viewingDateLabel} 没有速记，未导出。`);
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
      const notes = await listQuickNotesByDate(viewingDate);
      if (notes.length === 0) {
        showStatus(`${viewingDateLabel} 没有速记，未导出。`);
        return;
      }
      const markdown = quickNotesMarkdown(`速记 ${viewingDate}`, notes);
      await downloadQuickNotesMarkdown(markdown, viewingDate);
      showStatus(`已导出 ${notes.length} 条速记 Markdown。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function handleDeleteDate() {
    const dayNotes = await listQuickNotesByRange(viewingDate, viewingDate);
    const pinnedCount = dayNotes.filter((note) => note.pinned === true).length;
    const deletableCount = dayNotes.length - pinnedCount;
    if (deletableCount === 0) {
      showStatus(`${viewingDateLabel} 没有可清理的速记。`);
      return;
    }

    const confirmed = await confirm({
      title: `删除 ${viewingDateLabel} 的速记？`,
      body: (
        <div className="space-y-1">
          {viewingDate !== today && <p className="font-medium text-danger">这不是今天，你正要删除 {viewingDateLabel}（{viewingDate}）的记录。</p>}
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

    const result = await deleteQuickNotesByRange(viewingDate, viewingDate);
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
      {/* 顶部间距走 --page-top-gap（原 pt-3 / sm:pt-4）：有系统安全区时归零，避免与安全区自带的
          呼吸位叠成刘海下方那条空带；桌面 / 无刘海设备上取值不变，见 index.css 的变量注释。 */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-page/95 px-4 pb-2 [padding-top:var(--page-top-gap)] backdrop-blur sm:pb-3 sm:[padding-top:var(--page-top-gap-lg)] sm:shadow-elev1">
        {selectionMode ? (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
            <button
              type="button"
              aria-label="退出多选"
              onClick={exitSelection}
              className="flex size-9 shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-ink-2"
            >
              <Icon icon={X} size={16} />
            </button>
            <span className="min-w-0 flex-1 truncate td-text-label font-medium text-ink">
              已选 <span className="td-num">{selectedIds.size}</span> 条
              {selectedPinnedCount > 0 && (
                <span className="text-ink-3">
                  {" "}
                  · 含置顶 <span className="td-num">{selectedPinnedCount}</span>
                </span>
              )}
            </span>
            <button
              type="button"
              aria-pressed={allLoadedSelected}
              disabled={loadedUnpinnedIds.length === 0}
              onClick={toggleSelectAllLoaded}
              className="td-text-label rounded-ctl border border-border bg-surface px-3 py-1.5 text-ink-2 disabled:cursor-not-allowed disabled:text-ink-3"
            >
              {allLoadedSelected ? "取消全选" : "全选"}
            </button>
            {pinnedNotes.length > 0 && (
              <button
                type="button"
                aria-label={`${pinnedOpen ? "收起" : "查看"}置顶速记，${pinnedNotes.length} 条`}
                aria-haspopup="dialog"
                aria-expanded={pinnedOpen}
                onClick={() => setPinnedOpen((open) => !open)}
                className="relative flex size-9 shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-ink-2"
              >
                <Icon icon={PushPin} size={16} />
                <span className="td-num td-text-caption absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-pill bg-accent px-1 font-semibold leading-5 text-page">
                  {pinnedNotes.length}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => void handleBatchCopy()}
              className="rounded-ctl border border-border bg-surface px-3 py-1.5 td-text-label text-ink-2 disabled:cursor-not-allowed disabled:text-ink-3"
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
                className="rounded-ctl border border-border bg-surface px-3 py-1.5 td-text-label text-ink-2 disabled:cursor-not-allowed disabled:text-ink-3"
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
              className="rounded-ctl border border-danger/40 bg-danger/10 px-3 py-1.5 td-text-label font-medium text-danger disabled:cursor-not-allowed disabled:text-ink-3"
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
              className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-3 outline-none"
            />
            <button
              type="button"
              aria-label="退出搜索"
              onClick={() => closeSearch()}
              className="shrink-0 rounded-pill px-3 py-1.5 td-text-label font-medium text-ink-2 transition hover:text-ink"
            >
              取消
            </button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <div className="min-w-0 flex-1">
              {!timeline.atLatest && (
                <span className="rounded-pill border border-border-strong bg-surface px-2 py-0.5 td-text-caption font-medium text-ink-3">
                  历史
                </span>
              )}
            </div>
            <Link
              to="/diary"
              aria-label="日记"
              className="flex size-9 shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink sm:size-11"
            >
              <Icon icon={BookOpen} size={16} />
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
                className="relative flex size-9 shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink sm:size-11"
              >
                <Icon icon={PushPin} size={16} />
                <span className="td-num absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-pill bg-accent px-1 td-text-caption font-semibold leading-5 text-page">
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
                className="flex size-9 items-center justify-center rounded-pill border border-border bg-surface leading-none text-ink-2 transition hover:border-accent hover:text-ink sm:size-11"
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
                      className="block w-full px-4 py-3 text-left td-text-label font-medium text-danger transition hover:bg-danger/15"
                    >
                      {deleteDateLabel}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {!searchOpen && pinnedOpen && pinnedNotes.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[var(--z-modal)] px-4">
            <section
              aria-label="置顶速记"
              className="mx-auto flex max-h-[min(52vh,24rem)] w-full max-w-3xl flex-col gap-2 overflow-y-auto rounded-card border border-border bg-surface p-3 shadow-elev2"
            >
              <p className="px-1 td-text-caption font-semibold text-ink-3">
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
                    className={`${NOTE_CARD_BASE} rounded-row td-text-body ${isAgentNote ? NOTE_CARD_AGENT : "border-border bg-page/70"} ${
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
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 [padding-bottom:var(--pad-bottom)] [scroll-padding-bottom:var(--pad-bottom)]"
        // 兜底类 [padding-bottom/scroll-padding-bottom:var(--pad-bottom)]：env() 未定义环境
        //（Firefox 桌面 / 旧 WebView）里 calc 整条失效、内联 padding 被丢弃，由它还原批次前的纯数值
        // contentBottomInsetPx（桌面浏览器 env()=0，calc 有效时内联样式优先，兜底类不生效）。
        style={
          {
            "--pad-bottom": `${contentBottomInsetPx}px`,
            paddingBottom: `calc(${contentBottomInsetPx}px + var(--safe-bottom))`,
            scrollPaddingBottom: `calc(${contentBottomInsetPx}px + var(--safe-bottom))`,
          } as CSSProperties
        }
        aria-label="速记列表"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {searchOpen ? (
            !hasQuery ? (
              <EmptyState variant="card" title="输入关键词搜索速记，空格分隔多个词表示同时包含" />
            ) : searchResults.length === 0 ? (
              <EmptyState variant="card" title="没有匹配的速记" />
            ) : (
              <>
                {/* 搜索态同样按天分包裹：sticky 包含块的语义前提与主线一致，见 dayGroups.ts。
                    这里的日期条是**纯展示**，里面不能有任何 button——误触会把人拽离搜索流。 */}
                {searchDayGroups.map((group) => (
                  <div key={group.key} className="flex flex-col gap-4">
                    {group.date && (
                      <div
                        data-search-date={group.date.localDate}
                        className="quick-note-date-divider sticky top-2 z-10 flex items-center justify-center"
                      >
                        <div className="rounded-pill border border-border bg-surface px-2.5 td-text-body font-medium text-ink-3">
                          {group.date.label}
                        </div>
                      </div>
                    )}
                    {group.notes.map((entry) => {
                      const note = entry.note;
                      const isAgentNote = note.source === "agent";
                      // 卡片本体不再可点（误触就被拽离搜索流）；跳时间线走角上的定位小按钮。
                      return (
                        <div
                          key={entry.key}
                          data-note-id={note.id}
                          className={`${NOTE_CARD_BASE} rounded-card ${isAgentNote ? NOTE_CARD_AGENT : NOTE_CARD_DEFAULT}`}
                        >
                          <span className="float-right ml-2 flex items-center gap-1.5">
                            <time className="td-time td-text-caption text-ink-3">
                              {formatLocalClock(note.occurredAt)}
                            </time>
                            <button
                              type="button"
                              aria-label="定位到时间线"
                              title="定位到时间线"
                              onClick={() => void handleResultClick(note)}
                              className="flex size-8 shrink-0 items-center justify-center rounded-pill border border-border bg-surface text-ink-3 transition hover:border-accent hover:text-ink"
                            >
                              <Icon icon={Crosshair} size={14} />
                            </button>
                          </span>
                          {isAgentNote && (
                            <div className="mb-1 td-text-caption font-semibold text-accent-ink">
                              {note.sourceLabel ?? "助手"}
                            </div>
                          )}
                          <HighlightedText text={note.text} terms={searchTerms} />
                        </div>
                      );
                    })}
                  </div>
                ))}
                {searchHiddenCount > 0 && (
                  <div className="flex justify-center pb-1">
                    <button
                      type="button"
                      aria-label="加载更多搜索结果"
                      onClick={() => setSearchLimit((limit) => limit + SEARCH_RESULT_PAGE_SIZE)}
                      className="rounded-pill border border-border bg-surface px-3 py-1.5 td-text-caption font-medium text-ink-3 transition hover:border-accent hover:text-ink-2"
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
                    className="rounded-pill border border-border bg-surface px-3 py-1.5 td-text-caption font-medium text-ink-3 transition hover:border-accent hover:text-ink-2"
                  >
                    加载更早
                  </button>
                </div>
              )}

              {timeline.loading && (
                <LoadingState label="正在读取速记..." className="rounded-card border border-border bg-surface/60 px-4 py-8" />
              )}

              {!timeline.loading && displayItems.length === 0 && pinnedNotes.length === 0 && (
                <EmptyState
                  variant="card"
                  title="还没有速记"
                  description="写下一个想法、线索或待办，稍后再回来看。"
                />
              )}

              {/* 每天一个包裹 div：它就是这一天日期条的 sticky 包含块，下一天的包裹上来时
                  会把这一天的日期条顶出视口（Telegram 同款）。别给它加 overflow/contain/
                  transform/filter——任何一个都会掐断内部 sticky 或改写包含块。
                  内外都 gap-4：天与天、日期条与气泡、气泡与气泡的间距仍统一是 1rem。 */}
              {dayGroups.map((group) => {
                const dayIds = group.date ? (noteIdsByLocalDate.get(group.date.localDate) ?? []) : [];
                const daySelected = dayIds.length > 0 && dayIds.every((id) => selectedIds.has(id));
                const groupDate = group.date;
                return (
                  <div key={group.key} className="flex flex-col gap-4">
                    {groupDate && (
                      <div
                        data-date-label={groupDate.label}
                        data-local-date={groupDate.localDate}
                        // w-fit mx-auto 是承重的：DateField 基础类带 w-full，容器不收窄
                        // 药丸就会被撑成通栏（w-full 解析成父级宽），别当排版类顺手删掉。
                        className="quick-note-date-divider sticky top-2 z-10 mx-auto flex w-fit items-center gap-2"
                      >
                        <DateField
                          value={groupDate.localDate}
                          ariaLabel={`${groupDate.label}，点击跳转到其他日期`}
                          onChange={(next) => {
                            if (next) handleJumpDateChange(next);
                          }}
                          onOpenChange={setDatePickerOpen}
                          portal
                          hideIcon
                          className="min-h-0 rounded-pill border border-border bg-surface px-2.5 td-text-body font-medium text-ink-3 shadow-none"
                          formatValue={() => <span>{groupDate.label}</span>}
                        />
                        {selectionMode && (
                          <button
                            type="button"
                            aria-label={`${daySelected ? "取消选中" : "选中"}${groupDate.label}的速记`}
                            aria-pressed={daySelected}
                            onClick={() => toggleSelectDay(groupDate.localDate)}
                            className={`shrink-0 rounded-pill border px-3 py-1 td-text-caption font-medium transition ${
                              daySelected
                                ? "border-accent bg-accent-soft text-accent-ink"
                                : "border-border bg-surface text-ink-3 hover:border-accent hover:text-ink-2"
                            }`}
                          >
                            {daySelected ? "已选这天" : "选中这天"}
                          </button>
                        )}
                      </div>
                    )}
                    {group.notes.map((entry) => {
                      const note = entry.note;
                      const isAgentNote = note.source === "agent";
                      const selected = selectedIds.has(note.id);
                      const pending = unsyncedQuickNoteIds.has(note.id);
                      return (
                        <article key={entry.key}>
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
                                className={`absolute right-2 top-2 flex size-5 items-center justify-center rounded-pill border ${
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
                  </div>
                );
              })}
            </>
          )}
        </div>
      </section>

      {!searchOpen && shouldShowJumpToLatest({ atBottom, atLatest: timeline.atLatest }) && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="fixed right-4 rounded-pill border border-border-strong bg-surface px-3 py-2 td-text-caption font-medium text-ink-2 shadow-elev1 transition hover:border-accent hover:text-ink [bottom:var(--bottom-offset)]"
          // 兜底类 [bottom:var(--bottom-offset)]：env() 未定义环境（Firefox 桌面 / 旧 WebView）里 calc
          // 整条失效、内联 bottom 被丢弃，由它还原批次前的纯数值位置（floatBottomInsetPx，原口径
          // navOffsetPx + bottomInsetPx，现走合成并计入键盘高）。
          style={
            {
              "--bottom-offset": `${floatBottomInsetPx}px`,
              bottom: `calc(${floatBottomInsetPx}px + var(--safe-bottom))`,
            } as CSSProperties
          }
        >
          <span className="inline-flex items-center gap-1">
            <Icon icon={ArrowDown} size={14} />
            <span>最新</span>
          </span>
        </button>
      )}

      {error && (
        <p
          className="fixed left-4 right-4 mx-auto max-w-3xl rounded-card border border-danger/40 bg-danger/10 px-3 py-2 td-text-body text-danger shadow-elev1 [bottom:var(--bottom-offset)]"
          // 兜底类 [bottom:var(--bottom-offset)]：见「最新」按钮同款注释。
          style={
            {
              "--bottom-offset": `${floatBottomInsetPx}px`,
              bottom: `calc(${floatBottomInsetPx}px + var(--safe-bottom))`,
            } as CSSProperties
          }
        >
          {error}
        </p>
      )}
      {status && (
        <p
          className="fixed left-4 right-4 mx-auto max-w-3xl rounded-card border border-border bg-surface/95 px-3 py-2 td-text-body text-ink-2 shadow-elev1 [bottom:var(--bottom-offset)]"
          style={
            {
              "--bottom-offset": `${floatBottomInsetPx}px`,
              bottom: `calc(${floatBottomInsetPx}px + var(--safe-bottom))`,
            } as CSSProperties
          }
        >
          {status}
        </p>
      )}
      {!searchOpen && !selectionMode && (
        <form
          ref={composerRef}
          aria-label="速记输入区"
          className="fixed left-0 right-0 border-t border-border bg-page/95 p-2 shadow-elev2 backdrop-blur transition-[bottom] duration-200 [bottom:var(--bottom-offset)] sm:p-3"
          // 兜底类 [bottom:var(--bottom-offset)]：env() 未定义环境（Firefox 桌面 / 旧 WebView）里 calc
          // 整条失效、内联 bottom 被丢弃，由它还原批次前的纯数值位置（composerBarBottomPx，原口径
          // navOffsetPx，现加键盘高——这是用户敲字的输入条本身，键盘弹起须浮到其上方，见文件头注释）。
          style={
            {
              "--bottom-offset": `${composerBarBottomPx}px`,
              bottom: `calc(${composerBarBottomPx}px + var(--safe-bottom))`,
            } as CSSProperties
          }
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
              <div className="mb-2 flex items-center justify-between rounded-card border border-accent/20 bg-accent-soft px-3 py-2 td-text-caption text-accent-ink">
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
                  className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 leading-relaxed text-ink placeholder:text-ink-3 outline-none"
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
          onEdit={() => void startEditing(menu.note)}
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
