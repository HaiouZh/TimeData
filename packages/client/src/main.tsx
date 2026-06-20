import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppUpdateProvider } from "./appUpdate.tsx";
import { migrateLocalSettingsToDexie, seedDefaultCategories } from "./db/index.ts";
import { runSchemaNormalizationIfNeeded } from "./db/schemaNormalization.ts";
import "lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css";
import "@fontsource/tinos/400.css";
import "@fontsource/tinos/400-italic.css";
import "@fontsource/tinos/700.css";
import "./index.css";

async function bootstrap(): Promise<void> {
  // 初始化（建默认分类、迁移本地设置）失败不应阻塞渲染，否则 IndexedDB 不可用时整页白屏。
  try {
    await seedDefaultCategories();
    await migrateLocalSettingsToDexie();
    await runSchemaNormalizationIfNeeded();
  } catch (error) {
    console.error("[bootstrap] 初始化失败，仍继续渲染:", error);
  }

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element #root not found.");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppUpdateProvider>
        <App />
      </AppUpdateProvider>
    </StrictMode>,
  );
}

void bootstrap();
