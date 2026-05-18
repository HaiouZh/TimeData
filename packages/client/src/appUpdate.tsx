import { useRegisterSW } from "virtual:pwa-register/react";
import { type ReactNode, createContext, useContext } from "react";

type AppUpdateContextValue = {
  needRefresh: boolean;
  updateApp: () => void;
  dismissUpdate: () => void;
};

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(
        () => {
          registration.update();
        },
        60 * 60 * 1000,
      );
    },
  });

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
