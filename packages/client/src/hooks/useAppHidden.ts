import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";

interface HiddenTarget {
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

/** 转后台事件：visibilitychange→hidden 与 pagehide。一次转后台可能连发几条，调用方要幂等。 */
export function subscribeWebAppHidden(onHidden: () => void, target: HiddenTarget = { document, window }): () => void {
  const handleVisibilityChange = () => {
    if (target.document.visibilityState === "hidden") onHidden();
  };
  const handlePageHide = () => {
    onHidden();
  };
  target.document.addEventListener("visibilitychange", handleVisibilityChange);
  target.window.addEventListener("pagehide", handlePageHide);
  return () => {
    target.document.removeEventListener("visibilitychange", handleVisibilityChange);
    target.window.removeEventListener("pagehide", handlePageHide);
  };
}

/** 与 `useAppResumeRefresh` 对称：网页事件 + 原生壳的 appStateChange(isActive:false)。 */
export function useAppHidden(onHidden: () => void): void {
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;

  useEffect(() => {
    const trigger = () => onHiddenRef.current();
    let disposed = false;
    let removeCapacitorListener: (() => void) | undefined;
    const removeWebListeners = subscribeWebAppHidden(trigger);

    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) trigger();
      })
        .then((listener) => {
          if (disposed) {
            void listener.remove();
            return;
          }
          removeCapacitorListener = () => {
            void listener.remove();
          };
        })
        .catch(() => {
          // 原生监听挂不上只少一路信号，网页事件仍在
        });
    }

    return () => {
      disposed = true;
      removeWebListeners();
      removeCapacitorListener?.();
    };
  }, []);
}
