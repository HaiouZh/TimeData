import { ArrowLeft } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard.js";
import { DiaryConflictError, fetchDiary, fetchDiaryConfig, saveDiary } from "../lib/diary/diaryApi.js";
import { detectEol } from "../lib/diary/eol.js";
import { applyIndent } from "../lib/diary/indent.js";
import { applyLinkShortcut } from "../lib/diary/link.js";
import { applyEnterInOrderedList } from "../lib/diary/orderedList.js";
import { type EditAction, runEditAction } from "../lib/diary/textareaEdit.js";

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DiaryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const today = useRef(todayDateString()).current;
  const { confirm, dialog } = useConfirm();
  // 行尾保护：记住原文件的主导行尾，保存时在 handleSave 还原（见该处红线注释）。
  // 必须是 ref 不是 state——它不参与渲染，用 state 会多一次渲染、还会污染 effect 依赖。
  const eolRef = useRef<"\r\n" | "\n">("\n");

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [template, setTemplate] = useState("");
  const [content, setContent] = useState("");
  const [baseMtime, setBaseMtime] = useState<number | null>(null);
  // 警示：dirty 现在只由 onChange 置位，不是内容比对，所以打开一个 CRLF 文件（eolRef 探测
  // 到 "\r\n" 但用户还没碰键盘）不会自己变脏。将来若有人把 dirty 改成"内容与加载值比对"，
  // 这里会连带踩坑：CRLF 文件会一打开就永远脏（textarea 里的 LF 版本永远不等于原始 CRLF 内容）。
  const [dirty, setDirty] = useState(false);
  // 站内换页 + 关标签页两条腿都由它管；页内「刷新重载」的确认仍走下面的 confirm
  useUnsavedChangesGuard({ when: dirty, confirm });
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
        // 必须在 setContent 之前、对原始 fetch 结果探测：一旦进了 textarea，
        // HTML 规范会把换行归一为 LF，\r 就没了，届时再探测永远判成 LF。
        eolRef.current = detectEol(doc.content);
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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // IME 组合态守卫：Enter/Tab/Ctrl+K 共用这一个 handler，这一行天然覆盖全部键位，
    // 满足 design §8 契约 4（“每个新键位各自复刻一遍”）。别把键位拆到各自的 useEffect 里，
    // 那样必然漏抄第三处。
    if (event.nativeEvent.isComposing) return;
    const field = event.currentTarget;

    let action: EditAction | null = null;
    if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      action = applyEnterInOrderedList(field.value, field.selectionStart, field.selectionEnd);
    } else if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      action = applyIndent(field.value, field.selectionStart, field.selectionEnd, event.shiftKey ? "out" : "in");
    } else if (
      event.key.toLowerCase() === "k" &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      // 一把抓 ctrlKey || metaKey，不做平台检测：本仓零平台嗅探代码，且嗅探在测试里的 stub
      // 会命中 test-buckets.mjs 的 stubGlobal 脏标记、把测试文件踢出快桶（4-键位语义.md §2.6）。
      // 已知代价（显式接受）：macOS 上 Ctrl+K（Emacs 风格 kill-to-end-of-line）也会被吃掉——
      // 它是次要绑定、有替代（Shift+End 再删），误伤代价是"一次编辑没发生"，不丢数据、可撤销。
      action = applyLinkShortcut(field.value, field.selectionStart, field.selectionEnd);
    }

    // null = 交还浏览器默认行为（换行在代码围栏内 / Tab 顶层逃生口）；非 null 一律吃掉按键——
    // 包括 { kind: "noop" }，它的语义就是"什么都不改但要吃掉"（Ctrl+K 含换行选区，或 Ctrl+K
    // 落在代码围栏 / front-matter 内——围栏内同样做不成链接，与"选区含换行"同一类，不再交还
    // 浏览器）；{ kind: "select" } 同样吃掉按键，但 runEditAction 只挪光标、不碰 setValue/markDirty
    // （Ctrl+K 落在已有链接上，用户只是想改地址，一个字没改不该变脏）。
    if (!action) return;
    event.preventDefault();
    runEditAction(field, action, setContent, () => setDirty(true));
  }

  async function handleSave(options: { force?: boolean } = {}) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // 行尾保护还原点：content 来自 textarea，规范保证其中不含 \r（jsdom 忠实实现了这条
      // 规范，本页 jsdom 接线测试可以真实复现丢失），所以这里不需要、也不应该先做防御性
      // normalize——那会让人误以为 content 可能带 \r。绝不在 onChange 里做这一步（红线：
      // 一加工 value，React 就整体回写 element.value，原生撤销栈当场清空，而且这种坏法
      // 静默、测试测不出）；也绝不改 content state 本身（否则三个编辑纯函数都要处理 \r，
      // 边界表整个翻倍，还会破坏 orderedList.ts 顶部"只服务 textarea、不处理 CRLF"的假设）。
      // 已知行为：若原文件本身混合行尾，这里会统一成主导行尾，产生一次全篇 diff——
      // 接受，混合行尾文件本就异常，统一比"随机保留一半"更可预期，且只发生一次。
      const body = eolRef.current === "\r\n" ? content.replaceAll("\n", "\r\n") : content;
      const result = await saveDiary(today, { content: body, baseMtime, force: options.force });
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

  // latest-ref：让 mount-once 的快捷键监听拿到最新的 dirty/saving/handleSave 闭包
  const shortcutSaveRef = useRef<() => void>(() => {});
  shortcutSaveRef.current = () => {
    if (dirty && !saving) void handleSave();
  };

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "s") return;
      // 在日记页一律拦掉浏览器"保存网页"对话框，无改动时保存为 no-op
      event.preventDefault();
      shortcutSaveRef.current();
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  async function handleReload() {
    if (
      dirty &&
      !(await confirm({ title: "丢弃当前修改？", body: "将丢弃当前修改，加载服务器版本。", danger: true }))
    )
      return;
    setError(null);
    const doc = await fetchDiary(today);
    // 行尾保护第二个写入点——最容易漏的那个。冲突后点「刷新重载」若不更新 eolRef，
    // 它还停在上一次的值，会把 LF 文件写成 CRLF 或反过来。同样必须在 setContent 之前。
    eolRef.current = detectEol(doc.content);
    setContent(doc.content);
    setBaseMtime(doc.mtime);
    setDirty(false);
    setConflict(false);
  }

  function handleBack() {
    // 脏态确认由 useUnsavedChangesGuard 统一处理，这里不再自己弹一次（否则会连弹两个）
    // 无 app 内历史时（书签 / PWA 快捷方式 / 硬刷新直接落地）navigate(-1) 是 no-op，
    // 兜底回速记页，与安卓返回键 androidBackNavigation.ts 的 /diary 分支保持一致。
    if (location.key === "default") navigate("/quick-notes", { replace: true });
    else navigate(-1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-page text-ink">
      {dialog}
      <header className="sticky top-0 z-[var(--z-dropdown)] flex shrink-0 items-center gap-3 border-b border-border bg-page/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          aria-label="返回"
          onClick={handleBack}
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
          // 红线：这里不许对 value 做任何加工（trim / 行尾转换 / 任何归一化）。一加工 React 就整体回写，
          // 原生撤销栈当场清空，而且这种坏法静默。这条守到本体：DiaryPage.successPath.test.tsx
          // 用真实 execCommand + 零回写计数器接上这个 onChange，一加工就变红。
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
