import { ArrowLeft } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { useConfirm } from "../hooks/useConfirm.tsx";
import { useNowMinute } from "../hooks/useNowMinute.js";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard.js";
import { DiaryConflictError, fetchDiary, fetchDiaryConfig, saveDiary } from "../lib/diary/diaryApi.js";
import { resolveDiaryDate } from "../lib/diary/diaryDate.js";
import { detectEol } from "../lib/diary/eol.js";
import { applyIndent } from "../lib/diary/indent.js";
import { applyLinkShortcut } from "../lib/diary/link.js";
import { applyEnterInOrderedList } from "../lib/diary/orderedList.js";
import { type EditAction, runEditAction } from "../lib/diary/textareaEdit.js";
import { getDateString } from "../lib/time.js";

export default function DiaryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { confirm, dialog } = useConfirm();
  // 行尾保护：记住原文件的主导行尾，保存时在 handleSave 还原（见该处红线注释）。
  // 必须是 ref 不是 state——它不参与渲染，用 state 会多一次渲染、还会污染 effect 依赖。
  const eolRef = useRef<"\r\n" | "\n">("\n");

  // 实时今天（Asia/Shanghai）。useNowMinute 是对齐到分钟边界的自重排 setTimeout，
  // 且挂了 useAppResumeRefresh——手机息屏一夜后回前台会立刻刷新，正是跨零点提示要的。
  const liveToday = getDateString(useNowMinute());
  // 跟随模式的日期锚 = 进入跟随模式那一刻的今天。只在 Task 4 的重锚点前进，
  // 绝不随 liveToday 自动前进——那就是跨零点把用户正在写的正文换到新文件。
  const [followAnchor, setFollowAnchor] = useState(() => getDateString(new Date()));
  const { date, rolledOver, clearParam } = resolveDiaryDate({
    param: searchParams.get("date"),
    liveToday,
    followAnchor,
  });

  // 深链 ?date=<今天> / 非法 / 未来：归一成无参形态，让它与裸 /diary 完全一致。
  // replace 不新增历史条目，返回键行为不变。这个 effect 自终止：清完 param 后
  // clearParam 变 false，即使 setSearchParams 引用变化导致重跑也会立刻早退。
  useEffect(() => {
    if (!clearParam) return;
    setSearchParams({}, { replace: true });
  }, [clearParam, setSearchParams]);

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [template, setTemplate] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [content, setContent] = useState("");
  const [baseMtime, setBaseMtime] = useState<number | null>(null);
  // 警示：dirty 现在只由 markDirty（onChange / 降级编辑）置位，不是内容比对，所以打开一个 CRLF 文件（eolRef 探测
  // 到 "\r\n" 但用户还没碰键盘）不会自己变脏。将来若有人把 dirty 改成"内容与加载值比对"，
  // 这里会连带踩坑：CRLF 文件会一打开就永远脏（textarea 里的 LF 版本永远不等于原始 CRLF 内容）。
  const [dirty, setDirty] = useState(false);
  // 编辑序号：每次用户改动 +1。handleSave 用它判断"保存在途中用户有没有继续打字"，
  // 是 ref 不是 state——它只在回调里读写，不参与渲染。
  const editRevisionRef = useRef(0);
  function markDirty() {
    editRevisionRef.current += 1;
    setDirty(true);
  }
  // 站内换页 + 关标签页两条腿都由它管；页内「刷新重载」的确认仍走下面的 confirm
  useUnsavedChangesGuard({ when: dirty, confirm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // config 与日期无关，只拉一次。不拆的话每切一天都多一次 /api/diary/config 往返，
  // 也多一次"config 请求失败 → 整页 loadFailed"的机会。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await fetchDiaryConfig();
        if (cancelled) return;
        setEnabled(config.enabled);
        setTemplate(config.template);
        setConfigLoaded(true);
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
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    if (!enabled || template === "") {
      setLoading(false);
      return; // 未挂载 vault / 未配模板：不调 fetchDiary，直接走对应提示分支
    }
    let cancelled = false;
    // 切日期必须重置这四个态——effect 自身一个都不会重置它们：
    // loading 只有 setLoading(false)、从没有 true（不重置 = 旧正文原地留着，用户
    // 对着上一天的内容打字然后被覆盖，这是四条里唯一的真数据风险）；
    // error/conflict 只有 handleSave/handleReload 会清（不重置 = 上一天的冲突条
    // 挂到新一天头上，点「仍然覆盖」会 force 掉新一天的文件）；
    // loadFailed 全文没有任何地方置 false（不重置 = 一次失败后永久全屏失败态）。
    setLoading(true);
    setError(null);
    setConflict(false);
    setLoadFailed(false);
    // baseMtime 也要清：切到 B 日、加载失败、用户点保存，会拿着 A 日的 mtime 去
    // PUT B 日，服务端 mtime 守卫判不等 → 假冲突，用户被诱导去点「仍然覆盖」。
    setBaseMtime(null);
    (async () => {
      try {
        const doc = await fetchDiary(date);
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
  }, [date, configLoaded, enabled, template]);

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
    runEditAction(field, action, setContent, markDirty);
  }

  async function handleSave(options: { force?: boolean } = {}) {
    if (saving) return;
    setSaving(true);
    setError(null);
    // 发起时的编辑序号：请求在途中用户可能继续打字，回来时得认得出来（见下面清脏处）
    const revisionAtRequest = editRevisionRef.current;
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
      const result = await saveDiary(date, { content: body, baseMtime, force: options.force });
      setBaseMtime(result.mtime);
      // 只有"这一发上传的就是当前内容"才清脏。用户在请求在途中继续打字时，那段内容从未上传，
      // 无条件 setDirty(false) 会连 useUnsavedChangesGuard 一起关掉——换页即静默丢数据。
      // 判据用编辑序号不用内容比对：dirty 一旦改成内容比对，CRLF 文件会一打开就永远脏
      // （textarea 按 HTML 规范把 \r\n 归一成 \n，与加载值天然不等，见上面 dirty 的警示注释）。
      if (editRevisionRef.current === revisionAtRequest) setDirty(false);
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
    let doc: Awaited<ReturnType<typeof fetchDiary>>;
    try {
      doc = await fetchDiary(date);
    } catch (err) {
      // 只出条状提示，不打成 loadFailed 全屏态：正文还在编辑器里、用户还能接着编辑和保存，
      // 换成全屏"加载失败"反而会把这份没上传的内容从屏幕上抹掉。冲突条也保留——冲突没解决。
      setError(err instanceof Error ? err.message : "重载失败");
      return;
    }
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
        <h1 className="min-w-0 flex-1 truncate td-text-body font-medium text-ink">日记 · {date}</h1>
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
            markDirty();
          }}
          onKeyDown={handleKeyDown}
          className="min-h-0 flex-1 resize-none bg-surface px-4 py-4 td-text-body text-ink outline-none"
        />
      )}
    </div>
  );
}
