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

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found.");
}

// 首帧优先：先挂载 React，再后台跑 IndexedDB 初始化链（详见 startup.ts 的安全性说明）。
createRoot(rootElement).render(
  <StrictMode>
    <AppUpdateProvider>
      <App />
    </AppUpdateProvider>
  </StrictMode>,
);

void runStartupTasks();