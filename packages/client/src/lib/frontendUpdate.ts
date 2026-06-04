export const CURRENT_BUILD_ID: string =
  typeof __TIMEDATA_BUILD_ID__ === "string" ? __TIMEDATA_BUILD_ID__ : "dev";

export async function fetchLatestBuildId(fetchFn?: typeof fetch): Promise<string | null> {
  const fetchVersion = fetchFn ?? (typeof fetch === "function" ? fetch : null);
  if (!fetchVersion) return null;

  try {
    const response = await fetchVersion("/version.json", { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as { buildId?: unknown };
    return typeof data.buildId === "string" ? data.buildId : null;
  } catch {
    return null;
  }
}

export async function hasFrontendUpdate(current = CURRENT_BUILD_ID, fetchFn?: typeof fetch): Promise<boolean> {
  const latestBuildId = await fetchLatestBuildId(fetchFn);
  return latestBuildId !== null && latestBuildId !== current;
}

export interface HardRefreshDeps {
  serviceWorker?: ServiceWorkerContainer;
  cacheStorage?: CacheStorage;
  reload: () => void;
}

export async function hardRefresh({ serviceWorker, cacheStorage, reload }: HardRefreshDeps): Promise<void> {
  try {
    if (serviceWorker) {
      const registrations = await serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if (cacheStorage) {
      const keys = await cacheStorage.keys();
      await Promise.all(keys.map((key) => cacheStorage.delete(key)));
    }
  } catch {
    // 清理失败时仍然 reload，保留这条手动自救路径的确定性。
  } finally {
    reload();
  }
}
