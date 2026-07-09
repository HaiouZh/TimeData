import { ArrowLeft } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { DiaryConflictError, fetchDiary, fetchDiaryConfig, saveDiary } from "../lib/diary/diaryApi.js";
import { applyEnterInOrderedList } from "../lib/diary/orderedList.js";

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DiaryPage() {
  const navigate = useNavigate();
  const today = useRef(todayDateString()).current;
  const { confirm, dialog } = useConfirm();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [template, setTemplate] = useState("");
  const [content, setContent] = useState("");
  const [baseMtime, setBaseMtime] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await fetchDiaryConfig();
        if (cancelled) return;
        setEnabled(config.enabled);
        setTemplate(config.template);
        if (!config.enabled || config.template === "") {
          setLoading(false);
          return; // 未挂载 vault / 未配模板：不调 fetchDiary，直接走对应提示分支
        }
        const doc = await fetchDiary(today);
        if (cancelled) return;
        setContent(doc.content);
        setBaseMtime(doc.mtime);
        setDirty(false);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setLoadFailed(true);
        setError(err instanceof Error ? err.message : "加载失败");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // IME 候选确认的 Enter 不参与续号
    if (event.nativeEvent.isComposing) return;
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.currentTarget;
    const result = applyEnterInOrderedList(target.value, target.selectionStart, target.selectionEnd);
    if (!result) return;
    event.preventDefault();
    setContent(result.value);
    setDirty(true);
    const cursor = result.cursor;
    requestAnimationFrame(() => {
      target.setSelectionRange(cursor, cursor);
    });
  }

  async function handleSave(options: { force?: boolean } = {}) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveDiary(today, { content, baseMtime, force: options.force });
      setBaseMtime(result.mtime);
      setDirty(false);
      setConflict(false);
    } catch (err) {
      if (err instanceof DiaryConflictError) {
        setConflict(true);
        return;
      }
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    if (
      dirty &&
      !(await confirm({ title: "丢弃当前修改？", body: "将丢弃当前修改，加载服务器版本。", danger: true }))
    )
      return;
    setError(null);
    const doc = await fetchDiary(today);
    setContent(doc.content);
    setBaseMtime(doc.mtime);
    setDirty(false);
    setConflict(false);
  }

  async function handleBack() {
    if (dirty && !(await confirm({ title: "确定离开？", body: "有未保存的修改，确定离开？", danger: true }))) return;
    navigate(-1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-page text-ink">
      {dialog}
      <header className="sticky top-0 z-[var(--z-dropdown)] flex shrink-0 items-center gap-3 border-b border-border bg-page/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          aria-label="返回"
          onClick={() => void handleBack()}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink"
        >
          <Icon icon={ArrowLeft} size={16} />
        </button>
        <h1 className="min-w-0 flex-1 truncate td-text-body font-medium text-ink">日记 · {today}</h1>
        <button
          type="button"
          aria-label="保存"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
          className="rounded-xl bg-accent px-3 py-1.5 td-text-body font-medium text-page transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-ink-3"
        >
          保存
        </button>
      </header>

      {conflict && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-danger/40 bg-danger-soft px-4 py-2 td-text-body text-danger">
          <span className="flex-1">日记已被其他窗口修改</span>
          <button
            type="button"
            onClick={() => void handleReload()}
            className="rounded-xl border border-danger/40 bg-surface px-3 py-1 td-text-body font-medium text-danger"
          >
            刷新重载
          </button>
          <button
            type="button"
            onClick={() => void handleSave({ force: true })}
            className="rounded-xl bg-danger px-3 py-1 td-text-body font-medium text-page"
          >
            仍然覆盖
          </button>
        </div>
      )}

      {error && (
        <p className="shrink-0 border-b border-danger/40 bg-danger-soft px-4 py-2 td-text-body text-danger">{error}</p>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center td-text-body text-ink-3">正在加载...</div>
      ) : loadFailed ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center td-text-body text-ink-3">
          加载失败，请检查网络后重试
        </div>
      ) : !enabled ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center td-text-body text-ink-3">
          服务器未配置日记 vault（DIARY_VAULT_DIR）
        </div>
      ) : template === "" ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center td-text-body text-ink-3">
          还没有配置日记模板，去{" "}
          <Link to="/settings/diary" className="text-accent-ink underline">
            设置 · 日记
          </Link>{" "}
          配置一个吧
        </div>
      ) : (
        <textarea
          aria-label="日记正文"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setDirty(true);
          }}
          onKeyDown={handleKeyDown}
          className="min-h-0 flex-1 resize-none bg-surface px-4 py-4 td-text-body text-ink outline-none"
        />
      )}
    </div>
  );
}
