import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppUpdateProvider } from "./appUpdate.tsx";
import { runStartupTasks } from "./startup.ts";
import "lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css";
import "@fontsource/tinos/400.css";
import "@fontsource/tinos/400-italic.css";
import "@fontsource/tinos/700.css";
import "./index.css";
import { CaptureApp } from "./capture/CaptureApp.tsx";
import { isCaptureWindow } from "./lib/desktop/shell.ts";
import { installSchedulerPortTap } from "./lib/schedulerHostGuard.ts";

// 挂在 React 首次调度之前即可（渲染在下面才发生），与 import 求值顺序无关——原因见该模块注释。
installSchedulerPortTap();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found.");
}

// 浮窗与主窗口吃同一份产物，分流必须在这里——早于任何 Provider。
// 放到 App 内部去判断是不够的：AppUpdateProvider 与 DesktopBridge 都在它外层/内层，
// 「浮窗不挂它们」要靠这条分支根本走不到那些代码来保证，而不是靠谁记得写 if。
if (isCaptureWindow()) {
  createRoot(rootElement).render(
    <StrictMode>
      <CaptureApp />
    </StrictMode>,
  );
} else {
  // 首帧优先：先挂载 React，再后台跑 IndexedDB 初始化链（详见 startup.ts 的安全性说明）。
  createRoot(rootElement).render(
    <StrictMode>
      <AppUpdateProvider>
        <App />
      </AppUpdateProvider>
    </StrictMode>,
  );
  // 建默认分类 / 迁移本地设置 / schema 归一 / occurrence 物化——浮窗一样都不需要，
  // 两个窗口都跑还多一层并发。Dexie 本身在 db/index.ts 导入时即可用，浮窗写库不受影响。
  void runStartupTasks();
}