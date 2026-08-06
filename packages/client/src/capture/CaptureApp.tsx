import { useEffect, useRef } from "react";

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
export function CaptureApp() {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex h-dvh items-start bg-page p-3">
      <div className="w-full rounded-card border border-border bg-surface/95 p-2 shadow-elev2">
        <textarea
          ref={inputRef}
          aria-label="速记浮窗输入框"
          rows={1}
          className="w-full resize-none bg-transparent px-2 py-1 text-ink outline-none"
        />
      </div>
    </div>
  );
}
