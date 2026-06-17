import { useSyncExternalStore } from "react";

const WIDE_SCREEN_QUERY = "(min-width: 1024px)";

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(WIDE_SCREEN_QUERY);
}

function getSnapshot(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

function subscribe(onStoreChange: () => void): () => void {
  const media = getMediaQueryList();
  if (!media) return () => {};

  const listener = () => onStoreChange();
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function useIsWideScreen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
