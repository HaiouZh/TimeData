import { useCallback, useState } from "react";
import { safeGetItem, safeSetItem } from "./safeStorage.js";
import { STORAGE_KEYS } from "./storageKeys.js";

export type GalaxyEngineMode = "deterministic" | "settle";

export function readGalaxyEngineMode(): GalaxyEngineMode {
  return safeGetItem(STORAGE_KEYS.galaxyEngine) === "settle" ? "settle" : "deterministic";
}

export function writeGalaxyEngineMode(mode: GalaxyEngineMode): void {
  safeSetItem(STORAGE_KEYS.galaxyEngine, mode);
}

export function useGalaxyEngineMode(): [GalaxyEngineMode, (mode: GalaxyEngineMode) => void] {
  const [mode, setMode] = useState<GalaxyEngineMode>(() => readGalaxyEngineMode());
  const update = useCallback((next: GalaxyEngineMode) => {
    writeGalaxyEngineMode(next);
    setMode(next);
  }, []);
  return [mode, update];
}
