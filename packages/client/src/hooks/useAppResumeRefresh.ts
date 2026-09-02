import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";

/** 恢复事件从哪来。看门狗把它记进现场：iOS 壳里同一次回前台会连发几条，谁最后到、来了几条都有诊断价值。 */
export type ResumeSource = "visibilitychange" | "focus" | "pageshow" | "appStateChange";

interface ResumeRefreshTarget {
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

export function subscribeWebAppResumeRefresh(
  onResume: (source: ResumeSource) => void,
  target: ResumeRefreshTarget = { document, window },
): () => void {
  const handleVisibilityChange = () => {
    if (target.document.visibilityState === "visible") onResume("visibilitychange");
  };

  const handleFocus = () => {
    onResume("focus");
  };

  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) onResume("pageshow");
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

export function useAppResumeRefresh(onResume: (source: ResumeSource) => void) {
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    const trigger = (source: ResumeSource) => onResumeRef.current(source);
    let disposed = false;
    let removeCapacitorListener: (() => void) | undefined;
    const removeWebListeners = subscribeWebAppResumeRefresh(trigger);

    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) trigger("appStateChange");
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
