import { useCallback, useEffect, useRef, useState } from "react";
import { addQuickNote } from "../lib/quickNotes.js";
import type { DesktopHotkeyEvent } from "../lib/desktop/api.js";
import { invokeDesktop, listenDesktopHotkey } from "../lib/desktop/api.js";
import { clearCaptureDraft, readCaptureDraft, writeCaptureDraft } from "./captureDraft.js";

type CaptureStatus = "idle" | "saving" | "saved" | "error";

export interface CaptureIo {
  listen: (handler: (event: DesktopHotkeyEvent) => void) => Promise<() => void>;
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

export interface CaptureAppProps {
  /**
   * 存完闪完之后收窗口。**不传时走真壳的 `hide_capture_window`**——默认实现在组件里，
   * 不在调用方：生产的 `main.tsx` 渲染的是无 prop 的 `<CaptureApp />`，靠调用方注入
   * 就等于没有（而测试注入 mock 照样全绿）。传它只为在测试里断言收窗口这个动作发生过。
   */
  onHide?: () => void;
  /** 存一条速记。默认走 addQuickNote，测试里可注入失败/挂起。 */
  save?: (text: string) => Promise<unknown>;
  /** 存成功后的回调（壳侧用不到，留给测试与将来的埋点）。 */
  onSaved?: () => void;
  /** 「已记下」停留多久。 */
  savedFlashMs?: number;
  /** 壳的 IPC 接触面。抽成参数，接线顺序才能在测试里断言。 */
  io?: CaptureIo;
}

const DEFAULT_SAVED_FLASH_MS = 500;

/**
 * 速记浮窗根组件。
 *
 * **这条分支上刻意没有的东西**（全部是结构性保证，不是忘了写）：
 * - `DesktopBridge`——浮窗挂第二个热键桥会让一次打点落两条完全重叠的假记录；
 * - `AppUpdateProvider`——它在 window.focus 上查版本、命中即清缓存重载，而热键唤起每次都是
 *   一次 focus，挂上等于「正在打的字随时可能被一次重载吞掉」；
 * - `SyncProvider`——两份同步引擎会同时往服务器推；浮窗写的速记由主窗口那份的兜底轮询捞走；
 * - 路由 / AppShell / `runStartupTasks()`——浮窗一样都不需要，少加载一份就是启动速度。
 *
 * 往这个文件里加 import 之前，先确认加的东西不属于上面四类。
 */
export function CaptureApp({ onHide, save, onSaved, io, savedFlashMs = DEFAULT_SAVED_FLASH_MS }: CaptureAppProps = {}) {
  const [text, setText] = useState(readCaptureDraft);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 收窗口。**默认实现不能省**：浮窗 `decorations: false` 没有关闭按钮、`skipTaskbar: true`
  // 不在任务栏里，没有这条 IPC 它就永远关不掉。测试注入 mock `onHide` 会全绿，而生产分支
  // 从来不传 prop——那样「存完隐藏」与 Esc 两条路都是空操作，屏幕正中留一个赶不走的置顶输入条。
  const hide = useCallback(() => {
    if (onHide) {
      onHide();
      return;
    }
    const invoke = io?.invoke ?? invokeDesktop;
    void invoke("hide_capture_window").catch(() => {
      // 收不起来也不该把「已经存进去了」这个结论一起吞掉。
    });
  }, [onHide, io]);

  const focusInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 光标置末：唤起时若上次留着草稿，接着写才顺手。
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  // 唤起接线。**先挂监听、后报 desktop_ready**：Rust 收到 ready 会立刻把就绪前排队的
  // 按键投出来，顺序颠倒这批补投就全打在没有听众的窗口上（与 DesktopBridge 同规矩）。
  useEffect(() => {
    const bridge = io ?? { listen: listenDesktopHotkey, invoke: invokeDesktop };
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const un = await bridge.listen((event) => {
          // 浮窗只认 capture。punch 走主窗口，即使因为哪天投递改回广播而漏到这里，
          // 也绝不能在浮窗里再处理一次——那正是「一次热键落两条记录」。
          if (event.action === "capture") focusInput();
        });
        if (cancelled) {
          un();
          return;
        }
        unlisten = un;
        await bridge.invoke("desktop_ready");
      } catch {
        // 壳没起来 / 事件权限缺失：浮窗仍可手动打字保存，不阻断。
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [io, focusInput]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    setStatus("saving");
    setError(null);
    try {
      await (save ? save(trimmed) : addQuickNote(trimmed));
    } catch (err) {
      // Rust 侧 invoke 失败 reject 的是字符串而非 Error；两种都要能读出人话。
      const message =
        err instanceof Error && err.message !== ""
          ? err.message
          : typeof err === "string" && err !== ""
            ? err
            : "存不进去";
      setError(message);
      setStatus("error");
      return;
    }
    setText("");
    clearCaptureDraft();
    setStatus("saved");
    onSaved?.();
  }, [text, save, onSaved]);

  // 「已记下」闪完再收窗口。写成 effect 而不是 submit 里的 await sleep：
  // 组件在闪的过程中被卸载时，定时器要跟着清掉，否则往已卸载的树上 setState。
  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => {
      setStatus("idle");
      hide();
    }, savedFlashMs);
    return () => clearTimeout(timer);
  }, [status, savedFlashMs, hide]);

  const onChange = useCallback((next: string) => {
    setText(next);
    writeCaptureDraft(next);
    // **saving 中一个字都不许动 status**：onKeyDown 那道「saving 中忽略一切按键」的闸是靠
    // status 判的，这里把它打回 idle 就等于解除闸——用户能在写入返回前再按一次回车发出
    // 第二个并发提交，而先完成的那个的续体会无条件清空文字与草稿，把他正在打的字一并带走。
    // textarea 的 readOnly 是第一道防线，这里是第二道（受控组件的 onChange 未必只由键入触发）。
    setStatus((prev) => (prev === "saving" ? prev : "idle"));
    setError(null);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // saving 中忽略一切按键。回车重复提交会写出多条重复速记；而放行 Esc 会让窗口在
      // 写入结果出来前就收起，成功与否都无处回显，留下「以为没存其实存了」的不确定状态。
      if (status === "saving") {
        event.preventDefault();
        return;
      }
      // **输入法组合中，回车与 Esc 都不归浮窗管**：组合态的回车是「确认候选词」、Esc 是
      // 「取消候选词」，被这里吃掉的话——回车会拿组合前的旧文本落库（React 不把组合中的字
      // 写进受控 state），Esc 会连窗口一起收走。中文是这个产品的第一输入方式，而浮窗正是
      // 快打快收的入口。**不 preventDefault**：要把这次按键原样让给输入法。
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        hide();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    },
    [status, hide, submit],
  );

  return (
    <div className="flex h-dvh items-start bg-page p-3">
      <div className="w-full rounded-card border border-border bg-surface/95 p-2 shadow-elev2">
        <textarea
          ref={inputRef}
          aria-label="速记浮窗输入框"
          rows={1}
          value={text}
          // 只读而不是 disabled：disabled 会让 textarea 失焦，saving 只有几十毫秒，
          // 焦点一丢一回反而闪。只读期间光标与选区都留在原处。
          readOnly={status === "saving"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="w-full resize-none bg-transparent px-2 py-1 text-ink outline-none"
        />
        {status === "saved" && (
          <p role="status" className="px-2 pb-1 td-text-caption text-accent-ink">
            已记下
          </p>
        )}
        {status === "error" && error !== null && (
          <p role="alert" className="px-2 pb-1 td-text-caption text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
