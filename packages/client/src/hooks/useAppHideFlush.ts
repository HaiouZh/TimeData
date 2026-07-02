import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";

interface AppHideTarget {
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

export function subscribeWebAppHide(
  onHide: () => void,
  target: AppHideTarget = { document, window },
): () => void {
  const trigger = () => onHide();

  const handleVisibilityChange = () => {
    if (target.document.visibilityState === "hidden") trigger();
  };

  const handlePageHide = () => {
    trigger();
  };

  target.document.addEventListener("visibilitychange", handleVisibilityChange);
  target.window.addEventListener("pagehide", handlePageHide);

  return () => {
    target.document.removeEventListener("visibilitychange", handleVisibilityChange);
    target.window.removeEventListener("pagehide", handlePageHide);
  };
}

export function useAppHideFlush(onHide: () => void) {
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    const trigger = () => onHideRef.current();
    let disposed = false;
    let removeCapacitorListener: (() => void) | undefined;
    const removeWebListeners = subscribeWebAppHide(trigger);

    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) trigger();
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
