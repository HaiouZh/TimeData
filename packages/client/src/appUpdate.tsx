import { useRegisterSW } from "virtual:pwa-register/react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef } from "react";
import { CURRENT_BUILD_ID, hardRefresh, hasFrontendUpdate } from "./lib/frontendUpdate.ts";

type AppUpdateContextValue = {
  needRefresh: boolean;
  updateApp: () => void;
  dismissUpdate: () => void;
  currentBuildId: string;
  forceRefresh: () => void;
};

export const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const updateIntervalRef = useRef<number | null>(null);
  const disposedRef = useRef(false);

  const clearUpdateInterval = useCallback(() => {
    if (updateIntervalRef.current !== null) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
  }, []);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      clearUpdateInterval();
      if (disposedRef.current || !registration) return;
      updateIntervalRef.current = window.setInterval(
        () => {
          registration.update();
        },
        60 * 60 * 1000,
      );
    },
  });

  const forceRefresh = useCallback(() => {
    void hardRefresh({
      serviceWorker: typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
      cacheStorage: typeof caches !== "undefined" ? caches : undefined,
      reload: () => window.location.reload(),
    });
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      clearUpdateInterval();
    };
  }, [clearUpdateInterval]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let running = false;

    const checkForUpdate = async () => {
      if (running) return;
      running = true;
      try {
        if (await hasFrontendUpdate()) {
          forceRefresh();
        }
      } finally {
        running = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForUpdate();
      }
    };
    const onFocus = () => {
      void checkForUpdate();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    void checkForUpdate();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [forceRefresh]);

  function updateApp() {
    updateServiceWorker(true);
  }

  function dismissUpdate() {
    setNeedRefresh(false);
  }

  return (
    <AppUpdateContext.Provider
      value={{ needRefresh, updateApp, dismissUpdate, currentBuildId: CURRENT_BUILD_ID, forceRefresh }}
    >
      {children}
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext);
  if (!context) {
    throw new Error("useAppUpdate must be used within AppUpdateProvider");
  }
  return context;
}
