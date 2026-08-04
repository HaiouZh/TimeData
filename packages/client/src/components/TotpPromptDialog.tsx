import { useEffect, useRef, useState } from "react";
import { messages } from "../lib/messages.ts";
import { registerTotpPrompt, type TotpPromptOptions } from "../lib/totpChallenge.ts";
import { Sheet } from "./ui/Sheet.js";

interface PendingPrompt {
  retry: boolean;
  resolve: (code: string | null) => void;
}

/**
 * 危险操作弹码对话框宿主。挂在 App 根部一次即可：
 * mount 时把自己的 prompt 实现注册进 totpChallenge 的模块级桥（仓库没有现成的
 * 命令式弹窗惯例，故用「模块级 setter 注册 + Provider 挂载」桥接），
 * callWithTotp 收到 totp_required 时经这里向用户要码。
 */
export function TotpPromptDialog() {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [code, setCode] = useState("");
  const pendingRef = useRef<PendingPrompt | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    registerTotpPrompt((options: TotpPromptOptions) => {
      return new Promise<string | null>((resolve) => {
        // 若已有一个弹窗在等（理论上不该并发），先把旧的按取消结掉，避免悬挂 Promise。
        pendingRef.current?.resolve(null);
        setCode("");
        setPending({ retry: options.retry, resolve });
      });
    });
    return () => {
      registerTotpPrompt(null);
      pendingRef.current?.resolve(null);
    };
  }, []);

  if (!pending) return null;

  const settle = (value: string | null) => {
    pending.resolve(value);
    setPending(null);
    setCode("");
  };

  const submit = () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    settle(trimmed);
  };

  return (
    <Sheet open title={messages.totp.promptTitle} onClose={() => settle(null)}>
      <form
        className="space-y-4 px-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {pending.retry && <p className="td-text-body text-danger">{messages.totp.promptRetry}</p>}
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={messages.totp.promptPlaceholder}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-ctl border border-border bg-surface-elevated px-3 py-2 text-ink"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => settle(null)}
            className="min-h-11 rounded-ctl border border-border px-4 td-text-label text-ink"
          >
            {messages.totp.promptCancel}
          </button>
          <button
            type="submit"
            disabled={!code.trim()}
            className="min-h-11 rounded-ctl bg-accent-strong px-4 td-text-label text-page disabled:opacity-50"
          >
            {messages.dialog.confirm}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
