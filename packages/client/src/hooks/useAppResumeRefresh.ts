import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";

interface ResumeRefreshTarget {
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

export function subscribeWebAppResumeRefresh(
  onResume: () => void,
  target: ResumeRefreshTarget = { document, window },
): () => void {
  const trigger = () => onResume();

  const handleVisibilityChange = () => {
    if (target.document.visibilityState === "visible") trigger();
  };

  const handleFocus = () => {
    trigger();
  };

  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) trigger();
  };

  target.document.addEventListener("visibilitychange", handleVisibilityChange);
  target.window.addEventListener("focus", handleFocus);
  target.window.addEventListener("pageshow", handlePageShow);

  return () => {
    target.document.removeEventListener("visibilitychange", handleVisibilityChange);
    target.window.removeEventListener("focus", handleFocus);
    target.window.removeEventListener("pageshow", handlePageShow);
  };
}

export function useAppResumeRefresh(onResume: () => void) {
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    const trigger = () => onResumeRef.current();
    let disposed = false;
    let removeCapacitorListener: (() => void) | undefined;
    const removeWebListeners = subscribeWebAppResumeRefresh(trigger);

    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) trigger();
      }).then((listener) => {
        if (disposed) {
          listener.remove();
          return;
        }

        removeCapacitorListener = () => listener.remove();
      });
    }

    return () => {
      disposed = true;
      removeWebListeners();
      removeCapacitorListener?.();
    };
  }, []);
}
