import { useRegisterSW } from "virtual:pwa-register/react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef } from "react";

type AppUpdateContextValue = {
  needRefresh: boolean;
  updateApp: () => void;
  dismissUpdate: () => void;
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

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

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      clearUpdateInterval();
    };
  }, [clearUpdateInterval]);

  function updateApp() {
    updateServiceWorker(true);
  }

  function dismissUpdate() {
    setNeedRefresh(false);
  }

  return (
    <AppUpdateContext.Provider value={{ needRefresh, updateApp, dismissUpdate }}>{children}</AppUpdateContext.Provider>
  );
}

export function useAppUpdate() {
  const context = useContext(AppUpdateContext);
  if (!context) {
    throw new Error("useAppUpdate must be used within AppUpdateProvider");
  }
  return context;
}
