const VIEWPORT_KEY_PREFIX = "timedata.goalGraphViewport.";
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;

export interface GoalGraphViewport {
  x: number;
  y: number;
  zoom: number;
}

type GoalGraphViewportStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getStorage(storage?: GoalGraphViewportStorage): GoalGraphViewportStorage | null {
  if (storage) return storage;
  try {
    return "localStorage" in globalThis ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

function getKey(id: string): string {
  return `${VIEWPORT_KEY_PREFIX}${id}`;
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeViewport(value: unknown): GoalGraphViewport | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof GoalGraphViewport, unknown>>;
  if (!isFiniteNumber(candidate.x) || !isFiniteNumber(candidate.y) || !isFiniteNumber(candidate.zoom)) {
    return null;
  }
  return {
    x: candidate.x,
    y: candidate.y,
    zoom: clampZoom(candidate.zoom),
  };
}

export function loadGoalGraphViewport(id: string, storage?: GoalGraphViewportStorage): GoalGraphViewport | null {
  const storageApi = getStorage(storage);
  if (!storageApi) return null;

  const key = getKey(id);
  const raw = storageApi.getItem(key);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    const viewport = normalizeViewport(parsed);
    if (!viewport) {
      storageApi.removeItem(key);
      return null;
    }
    return viewport;
  } catch {
    storageApi.removeItem(key);
    return null;
  }
}

export function saveGoalGraphViewport(
  id: string,
  viewport: GoalGraphViewport,
  storage?: GoalGraphViewportStorage,
): void {
  const storageApi = getStorage(storage);
  if (!storageApi) return;

  storageApi.setItem(
    getKey(id),
    JSON.stringify({
      x: viewport.x,
      y: viewport.y,
      zoom: clampZoom(viewport.zoom),
    }),
  );
}

export function clearGoalGraphViewport(id: string, storage?: GoalGraphViewportStorage): void {
  const storageApi = getStorage(storage);
  if (!storageApi) return;

  storageApi.removeItem(getKey(id));
}
