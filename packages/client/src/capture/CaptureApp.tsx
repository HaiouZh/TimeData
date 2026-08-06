import { useCallback, useEffect, useRef, useState } from "react";
import { addQuickNote } from "../lib/quickNotes.js";
import { clearCaptureDraft, readCaptureDraft, writeCaptureDraft } from "./captureDraft.js";

type CaptureStatus = "idle" | "saving" | "saved" | "error";

export interface CaptureAppProps {
  /** 存完闪完之后收窗口。壳外注入，测试里可断言。 */
  onHide?: () => void;
  /** 存一条速记。默认走 addQuickNote，测试里可注入失败/挂起。 */
  save?: (text: string) => Promise<unknown>;
  /** 存成功后的回调（壳侧用不到，留给测试与将来的埋点）。 */
  onSaved?: () => void;
  /** 「已记下」停留多久。 */
  savedFlashMs?: number;
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
export function CaptureApp({ onHide, save, onSaved, savedFlashMs = DEFAULT_SAVED_FLASH_MS }: CaptureAppProps = {}) {
  const [text, setText] = useState(readCaptureDraft);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // 光标置末：唤起时若上次留着草稿，接着写才顺手。
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

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
      onHide?.();
    }, savedFlashMs);
    return () => clearTimeout(timer);
  }, [status, savedFlashMs, onHide]);

  const onChange = useCallback((next: string) => {
    setText(next);
    writeCaptureDraft(next);
    setStatus("idle");
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
      if (event.key === "Escape") {
        event.preventDefault();
        onHide?.();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void submit();
      }
    },
    [status, onHide, submit],
  );

  return (
    <div className="flex h-dvh items-start bg-page p-3">
      <div className="w-full rounded-card border border-border bg-surface/95 p-2 shadow-elev2">
        <textarea
          ref={inputRef}
          aria-label="速记浮窗输入框"
          rows={1}
          value={text}
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
