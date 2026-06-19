import { useSyncExternalStore } from "react";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(COARSE_POINTER_QUERY);
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

export function useIsCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
