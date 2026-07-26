import { ArrowLeft } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import DateNav from "../components/DateNav.js";
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
import { DIARY_SPLIT_PREFS } from "../lib/tasks/workbenchPrefs.js";
import { formatMonthDay, getDateString } from "../lib/time.js";
import { useIsWideScreen } from "../lib/useIsWideScreen.js";
import { DiaryReferencePanel } from "./diary/DiaryReferencePanel.js";
import { ResizableSplit } from "./todo/ResizableSplit.js";

export default function DiaryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // location.key 只在首个历史条目上是 "default"；本页的 setSearchParams(replace) 会把它换成
  // 随机 key（切日期 / ?date= 归一都会），所以必须在挂载那一刻定下来，不能每次渲染现读——
  // 否则书签/PWA 直接落地后切一次日期，返回按钮就从"兜底回速记页"退化成 navigate(-1) 空转。
  const landedWithoutHistoryRef = useRef(location.key === "default");
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
  const wide = useIsWideScreen();

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
  // Critical 修复的另一半状态：handleReload 原先全程不置任何"重载在飞"标志，
  // handleSave 完全不知道有 reload 在路上（冲突条「仍然覆盖」按钮之前只看 saving，
  // reload 飞着时它是 false、可点）。force save 与 reload 反向交错会让 baseMtime
  // 落地到一份编辑器里已经不存在的内容上，见 handleReload/handleSave 内的用法。
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // 单调递增的加载世代号，取代原先的 dateRef 值比较——dateRef 比的是日期字符串，
  // 存在 ABA：切走再切回同一天（A→B→A），字符串又相等，识别不出这是上一轮加载的
  // 陈旧响应。世代号在正文加载 effect 每次真正重跑时 +1，严格单调，天然堵住 ABA。
  const loadEpochRef = useRef(0);
  // 同款活 ref：handleReload 在 await confirm(...) 之后要判断"这期间有没有别的写飞起来"，
  // 而闭包里的 saving 冻结在这次调用发生那一刻，await 期间外部 setSaving(true) 它读不到。
  const savingRef = useRef(saving);
  savingRef.current = saving;
  // 同款活 ref，给 handleSave 判断"这期间有没有 reload 飞起来"（Critical 修复的核心）：
  // handleReload 发出 fetchDiary 前 setReloading(true)，handleSave 入口据此挡下——
  // 不加这道，force save 会在 reload 飞着的时候钻进去。
  const reloadingRef = useRef(reloading);
  reloadingRef.current = reloading;

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
    // 世代号在每次 config 就绪后的"真实重跑"都要 +1（不管走不走 fetchDiary 分支）：
    // handleSave/handleReload 捕获的是发起请求那一刻的世代号，只要这个 effect 又跑过一次
    // （哪怕是切走再切回同一天的 A→B→A），世代号就已经前进，陈旧响应据此被挡下。
    loadEpochRef.current += 1;
    if (!enabled || template === "") {
      setLoading(false);
      return; // 未挂载 vault / 未配模板：不调 fetchDiary，直接走对应提示分支
    }
    let cancelled = false;
    // 切日期必须重置这五个态——effect 自身一个都不会重置它们：
    // loading 只有 setLoading(false)、从没有 true（不重置 = 旧正文原地留着，用户
    // 对着上一天的内容打字然后被覆盖，这是这里最直接的真数据风险）；
    // error/conflict 只有 handleSave/handleReload 会清（不重置 = 上一天的冲突条
    // 挂到新一天头上，点「仍然覆盖」会 force 掉新一天的文件）；
    // loadFailed 全文没有任何地方置 false（不重置 = 一次失败后永久全屏失败态）；
    // dirty 只有成功分支和 handleReload 会清，加载失败分支从来没清过（不重置 = 加载失败后
    // dirty 永久停在 true，把共享的 useUnsavedChangesGuard 钉死在武装状态，对着一份用户
    // 已经确认丢弃、屏幕上也不存在的内容反复弹"放弃未保存的修改？"）。这里清空是安全的：
    // switchDate 已经在调用方问过一次"放弃修改"，此处只是把该确认的结果落地，不会绕过确认。
    setLoading(true);
    setError(null);
    setConflict(false);
    setLoadFailed(false);
    setDirty(false);
    // 防御性清空，无可观测行为差异（已验证）：handleSave 现在 loading || loadFailed 都早退，
    // 这两个态覆盖了"content 还是上一天残留"的全部窗口，所以 saveDiary 不可能在 baseMtime
    // 仍是上面这次重置的旧值时被调用——要么早退（loading/loadFailed 未清），要么 fetchDiary
    // 已经成功并把 baseMtime 覆盖成 doc.mtime。删掉这行、跑 DiaryPage 全部 38 条测试验证过
    // 仍然全绿。留着是因为"切日期就清掉旧 mtime"语义上仍然对，且不给将来的改动留隐患
    // （万一以后 handleSave 的早退条件被弱化，这行还能兜底）；不要为它硬凑一条测试。
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
    // 防重入 + 挡 reload：读活 ref 不读闭包值。原来这里是 `if (saving) return;`——四个调用点
    // （header 保存按钮、Ctrl+S 快捷键、冲突条「仍然覆盖」等）全都在同一次渲染的闭包里，
    // saving 是冻结值，这道判据结构上永远取不到 true（Minor A：看着在防、实际不防的假闸）。
    // reloadingRef 是 Critical 修复的核心：不挡 reload 的话，冲突条「仍然覆盖」在 reload
    // 飞着的时候可点（disabled 之前只看 saving），force save 与 reload 反向交错，
    // baseMtime 会落地到一份编辑器里已经被 reload 替换掉的内容上。
    if (savingRef.current || reloadingRef.current) return;
    // loading || loadFailed 早退，同一个根因两个窗口：正文没成功加载出来时，content 里还是
    // 上一天残留的内容，且日期 effect 已经把 baseMtime 清成 null（见下面切日期重置五态的
    // 注释）——若在这里放行保存，会把上一天的内容写进新一天的文件；baseMtime=null 还会被
    // 服务端 mtime 并发守卫当成"文件不存在"直接放行，不报冲突、静默写坏新一天的文件。
    // loading 只挡到 fetchDiary 还在飞的那一段；fetchDiary reject 后 loading 变 false 但
    // loadFailed 变 true，同样的残留 content + null baseMtime 原样还在，不补 loadFailed
    // 这条守卫这个窗口就完全不设防。"loadFailed 时主区域是全屏加载失败提示、textarea 未挂载，
    // 用户碰不到保存"这个假设是错的——Ctrl+S 挂在 window 上、根本不经过 textarea，保存按钮
    // 本身在 loadFailed 态下也没有单独置灰，两条路都能触发 handleSave。
    if (loading || loadFailed) return;
    setSaving(true);
    // 「保存失败」条的唯一清除点：成功路径不碰 error，下一次成功保存全靠这里把上一次的
    // 失败提示清掉，漏了它会跟一份早已成功的保存永久共存。
    setError(null);
    // 发起时的编辑序号：请求在途中用户可能继续打字，回来时得认得出来（见下面清脏处）
    const revisionAtRequest = editRevisionRef.current;
    // 发起时的目标日期：请求在途中用户可能切日期，回来时这一发属于旧文件
    const dateAtRequest = date;
    // 发起时的加载世代号：与编辑序号闸正交——序号管"内容变没变"，世代号管"目标文件的
    // 加载生命周期换没换"。取代原先的 dateRef 值比较（见上面 loadEpochRef 声明处的 ABA 说明）。
    const epochAtRequest = loadEpochRef.current;
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
      const result = await saveDiary(dateAtRequest, { content: body, baseMtime, force: options.force });
      // 世代号闸：不加这道，A 日的 mtime 会写进 B 日的 baseMtime，B 日首次保存就带着别人的
      // mtime 去过服务端并发守卫 → 假冲突，用户被诱导去点「仍然覆盖」force 掉一个没冲突的文件。
      // 用世代号而不是日期值比较：切走再切回同一天（A→B→A），日期字符串又相等，值比较
      // 认不出这是上一轮加载的陈旧响应；世代号严格单调，天然堵住这个 ABA。
      if (loadEpochRef.current !== epochAtRequest) return;
      setBaseMtime(result.mtime);
      // 只有"这一发上传的就是当前内容"才清脏。用户在请求在途中继续打字时，那段内容从未上传，
      // 无条件 setDirty(false) 会连 useUnsavedChangesGuard 一起关掉——换页即静默丢数据。
      // 判据用编辑序号不用内容比对：dirty 一旦改成内容比对，CRLF 文件会一打开就永远脏
      // （textarea 按 HTML 规范把 \r\n 归一成 \n，与加载值天然不等，见上面 dirty 的警示注释）。
      if (editRevisionRef.current === revisionAtRequest) setDirty(false);
      setConflict(false);
    } catch (err) {
      // 同理：A 日的冲突/错误不该挂到 B 日头上（世代号闸，理由同上）
      if (loadEpochRef.current !== epochAtRequest) return;
      if (err instanceof DiaryConflictError) {
        setConflict(true);
        return;
      }
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      // saving 是页面级的"有没有在途保存"，与目标日期无关，无条件解锁——
      // 加日期判据会让切日后保存按钮永久置灰。
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
    // 防重入：连点两次「刷新重载」——disabled 属性正常情况下已经挡住（jsdom/浏览器都不会对
    // disabled 元素派发 click），这里是给未来可能出现的非按钮入口（比如快捷键）兜底，读活 ref
    // 不读闭包值，理由同 handleSave 入口（Minor A）。savingRef 挡的是"在途保存期间不许重载"：
    // 两个写操作交错会让 baseMtime 指向一份编辑器里已不存在的内容——force save 在写 A（回来
    // mtime=X），reload 先回来把正文换成 B/mtime=Y，随后 save resolve 又把 baseMtime 改回 X。
    // 此后用户随便改一个字保存，mtime 校验通过、不报冲突，刚写进去的 A 被 B 静默覆盖。
    if (savingRef.current || reloadingRef.current) return;
    if (
      dirty &&
      !(await confirm({ title: "丢弃当前修改？", body: "将丢弃当前修改，加载服务器版本。", danger: true }))
    )
      return;
    // 确认框开着的这段时间里 Ctrl+S 可能起了一发保存（快捷键走 window 监听，不看按钮置灰），
    // 再挡一次。**必须读活 ref 不能读闭包值**：闭包里的 saving/reloading 冻结在这次调用进入时
    // 的渲染值，await confirm(...) 期间外部 setSaving(true) 它读不到，与上面第一道判据恒同值
    // ——写成 `if (saving)` 的话这行结构上永远不生效，是一道看着在防、实际不防的假闸。
    if (savingRef.current || reloadingRef.current) return;
    const dateAtRequest = date;
    const revisionAtRequest = editRevisionRef.current;
    // 发起时的加载世代号，理由同 handleSave（取代 dateRef 值比较，堵住 ABA）。
    const epochAtRequest = loadEpochRef.current;
    // 这里不需要日期闸：confirm 的 await 期间用户理论上能切换日期，但实测走不到——
    // ① ConfirmSheet 背后是 Sheet.tsx 的 fixed inset-0 遮罩，真实点击路径下点不到 DateNav；
    // ② 唯一能切日期的 switchDate 自己也调用同一个单例 confirm()，而 useConfirm 的单槽
    // pending 被顶替时会把前一个 resolve(false)——本次 handleReload 的确认会在被顶替瞬间
    // 判定为"取消"提前 return，走不到这里。两重原因都不可达，故不加日期闸，也不为它硬凑测试。
    setError(null);
    // Critical 修复的核心写入点：发出 fetchDiary 之前置位，让 handleSave 的入口闸能读到
    // "reload 在飞"。必须在这里（await 之前）而不是 finally 唯一置位点之前的任何更早处，
    // 也不能晚于下面的 await——晚了会有一个"reload 已经决定要发但还没让 handleSave 挡得住"
    // 的窗口。
    setReloading(true);
    let doc: Awaited<ReturnType<typeof fetchDiary>>;
    try {
      doc = await fetchDiary(dateAtRequest);
    } catch (err) {
      if (loadEpochRef.current !== epochAtRequest) return;
      // 只出条状提示，不打成 loadFailed 全屏态：正文还在编辑器里、用户还能接着编辑，
      // 换成全屏"加载失败"反而会把这份没上传的内容从屏幕上抹掉。冲突条也保留——冲突没解决。
      // 前缀一句中文再带原始 message：这条是该路径唯一的用户反馈（不像首屏失败还配中文
      // 全屏兜底），真机离线时裸展示会是 "Failed to fetch"/"Load failed"，服务端 500 时
      // 是 "API error: 500 …"，用户只看到一串英文技术串。
      setError(`重载失败：${err instanceof Error ? err.message : "未知错误"}`);
      return;
    } finally {
      // 页面级的"有没有在途重载"，与目标日期/世代无关，无条件解锁——这里不加任何日期/
      // 世代判据：加了的话，一旦某一发 reload 因为日期切换被上面的判据早退，reloading
      // 就再也没有机会归位，会把保存按钮永久锁死。
      setReloading(false);
    }
    if (loadEpochRef.current !== epochAtRequest) return;
    if (editRevisionRef.current !== revisionAtRequest) {
      // 点了"确认丢弃"之后、fetch 回来之前用户又敲了字。这时盖上服务器版本，
      // 那段新内容既没上传、也从屏幕上消失了——与"保存在途打字被清脏"同类的静默丢数据。
      // 放弃这一发重载，让用户重新决定。
      setError("重载期间你又做了修改，已取消这次重载。需要丢弃请再点一次刷新重载。");
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

  async function switchDate(nextDate: string) {
    if (nextDate === date) return;
    // 全局离开守卫（useUnsavedChangesGuard）只比 pathname，?date= 变化它拦不到，
    // 所以这里必须自己问。反过来说也不会双弹层。文案单独写：并没有"离开"页面，
    // 复用守卫那套「离开后当前修改将丢失」语义不贴。
    if (
      dirty &&
      !(await confirm({
        title: `切到 ${formatMonthDay(nextDate)}？`,
        body: "当前修改尚未保存，切换后将丢失。",
        confirmLabel: "放弃修改",
        cancelLabel: "继续编辑",
        danger: true,
      }))
    )
      return;
    if (nextDate === liveToday) {
      // 回到今天 = 重回跟随模式。必须重锚：不重锚的话下一次跨零点 rolledOver 立刻为真，
      // 提示条会在用户刚点完"回到今天"时又冒出来。
      setFollowAnchor(liveToday);
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ date: nextDate }, { replace: true });
    }
  }

  function handleDateChange(nextDate: string) {
    void switchDate(nextDate);
  }

  function handleBack() {
    // 脏态确认由 useUnsavedChangesGuard 统一处理，这里不再自己弹一次（否则会连弹两个）
    // 无 app 内历史时（书签 / PWA 快捷方式 / 硬刷新直接落地）navigate(-1) 是 no-op，
    // 兜底回速记页，与安卓返回键 androidBackNavigation.ts 的 /diary 分支保持一致。
    // 读挂载时冻结的 ref，不现读 location.key（见该 ref 声明处的注释——切日期会打破它）。
    if (landedWithoutHistoryRef.current) navigate("/quick-notes", { replace: true });
    else navigate(-1);
  }

  const editor = (
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
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-page text-ink">
      {dialog}
      <header className="sticky top-0 z-[var(--z-dropdown)] shrink-0 border-b border-border bg-page/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            aria-label="返回"
            onClick={handleBack}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink-2 transition hover:border-accent hover:text-ink"
          >
            <Icon icon={ArrowLeft} size={16} />
          </button>
          <h1 className="min-w-0 flex-1 truncate td-text-body font-medium text-ink">日记</h1>
          <button
            type="button"
            aria-label="保存"
            disabled={!dirty || saving || reloading || loading || loadFailed}
            onClick={() => void handleSave()}
            className="rounded-xl bg-accent px-3 py-1.5 td-text-body font-medium text-page transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-ink-3"
          >
            保存
          </button>
        </div>
        {/* DateNav 一个字节都不许改：它有 3 条 check:design 逐字豁免（DateNav.tsx:11/24/25），
            匹配是「rule + 文件 + trim 后整行文本」三元组，改一个字符豁免就失配、门禁当场红。
            要调间距就在外面包容器。
            放在 header 内做第二行、而不是塞进下面的内容分支：阶段四要在 header 之下挂左右
            分栏，日期导航必须横跨两栏，掉进左栏就得返工。 */}
        <DateNav date={date} onDateChange={handleDateChange} />
      </header>

      {rolledOver && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-accent/40 bg-accent-soft px-4 py-2 td-text-body text-accent-ink">
          {/* 文案必须带具体日期：息屏几天后回前台可能一次跨好几天，
              写"新的一天"用户不知道要跳去哪 */}
          <span className="flex-1">
            已经是 {formatMonthDay(liveToday)} 了，当前还在写 {formatMonthDay(date)} 的日记
          </span>
          <button
            type="button"
            data-testid="diary-rollover-accept"
            onClick={() => void switchDate(liveToday)}
            className="rounded-xl border border-accent bg-surface px-3 py-1 td-text-body font-medium text-accent"
          >
            切到今天
          </button>
        </div>
      )}

      {conflict && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-danger/40 bg-danger-soft px-4 py-2 td-text-body text-danger">
          <span className="flex-1">日记已被其他窗口修改</span>
          <button
            type="button"
            disabled={saving || reloading}
            onClick={() => void handleReload()}
            className="rounded-xl border border-danger/40 bg-surface px-3 py-1 td-text-body font-medium text-danger disabled:cursor-not-allowed disabled:border-border disabled:text-ink-3"
          >
            刷新重载
          </button>
          <button
            type="button"
            disabled={saving || reloading}
            onClick={() => void handleSave({ force: true })}
            className="rounded-xl bg-danger px-3 py-1 td-text-body font-medium text-page disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-ink-3"
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
      ) : wide ? (
        <ResizableSplit
          prefs={DIARY_SPLIT_PREFS}
          className="min-h-0 flex-1"
          leftClassName="flex flex-col min-h-0"
          rightClassName="min-h-0 overflow-y-auto"
          left={editor}
          right={<DiaryReferencePanel date={date} isToday={date === liveToday} />}
        />
      ) : (
        editor
      )}
    </div>
  );
}
