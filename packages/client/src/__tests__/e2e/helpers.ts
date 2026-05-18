import "fake-indexeddb/auto";
import { db } from "../../db/index.ts";
import { safeSetItem } from "../../lib/safeStorage.js";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";

function installLocalStorage(): void {
  if ("localStorage" in globalThis) return;
  let store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      clear: () => {
        store = new Map<string, string>();
      },
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
    configurable: true,
  });
}

installLocalStorage();

export function bindClientToServer(serverApp: {
  fetch: (request: Request) => Response | Promise<Response>;
}): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("http://server")) {
      const request = new Request(url.replace("http://server", "http://x"), init);
      return serverApp.fetch(request);
    }
    return originalFetch(input, init);
  };
  safeSetItem(STORAGE_KEYS.apiUrl, "http://server");
  return () => {
    globalThis.fetch = originalFetch;
  };
}

export async function resetClientDb(): Promise<void> {
  localStorage.clear();
  await db.delete();
  await db.open();
}
