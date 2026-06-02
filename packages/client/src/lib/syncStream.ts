import { buildApiUrl } from "./api.js";
import { safeGetItem } from "./safeStorage.js";
import { STORAGE_KEYS } from "./storageKeys.js";

export type SyncStreamState = "connecting" | "connected" | "disconnected";

export interface SyncStreamMessage {
  event: string;
  data: string;
}

export interface SyncStreamHandle {
  start: () => void;
  stop: () => void;
  getConnectionState: () => SyncStreamState;
}

interface CreateSyncStreamOptions {
  onMessage: (message: SyncStreamMessage) => void;
  onStateChange: (state: SyncStreamState) => void;
  fetchImpl?: typeof fetch;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

export function nextBackoffMs(attempt: number, random = Math.random): number {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempt, 0), BACKOFF_MAX_MS);
  return exponential + random() * exponential * 0.25;
}

export function parseSseChunk(buffer: string): { events: SyncStreamMessage[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SyncStreamMessage[] = [];

  for (const block of parts) {
    if (block.trim() === "") continue;

    let event = "message";
    const dataLines: string[] = [];

    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join("\n") });
    }
  }

  return { events, rest };
}

function readApiUrl(): string {
  return safeGetItem(STORAGE_KEYS.apiUrl) || "";
}

function readToken(): string {
  return safeGetItem(STORAGE_KEYS.apiToken) || "";
}

export function createSyncStream(options: CreateSyncStreamOptions): SyncStreamHandle {
  let running = false;
  let state: SyncStreamState = "disconnected";
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;
  const fetchImpl = options.fetchImpl ?? fetch;

  function setState(nextState: SyncStreamState): void {
    if (state === nextState) return;
    state = nextState;
    options.onStateChange(nextState);
  }

  function scheduleReconnect(): void {
    if (!running || reconnectTimer) return;
    const delayMs = nextBackoffMs(reconnectAttempt);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void run();
    }, delayMs);
  }

  async function readLoop(): Promise<void> {
    const apiUrl = readApiUrl();
    if (!apiUrl) return;

    abortController = new AbortController();
    setState("connecting");
    const headers = new Headers();
    const token = readToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetchImpl(buildApiUrl(apiUrl, "/api/sync/stream"), {
      headers,
      signal: abortController.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Sync stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rest = "";

    try {
      while (running) {
        const { value, done } = await reader.read();
        if (done) break;

        const parsed = parseSseChunk(rest + decoder.decode(value, { stream: true }));
        rest = parsed.rest;

        for (const event of parsed.events) {
          if (event.event === "hello") {
            reconnectAttempt = 0;
            setState("connected");
          }
          options.onMessage(event);
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  async function run(): Promise<void> {
    if (!running) return;

    try {
      await readLoop();
    } catch {
      // Reconnect below; callers observe the state machine instead of individual transport errors.
    } finally {
      abortController = null;
    }

    if (running) {
      setState("disconnected");
      scheduleReconnect();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void run();
    },
    stop() {
      running = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      abortController?.abort();
      abortController = null;
      setState("disconnected");
    },
    getConnectionState() {
      return state;
    },
  };
}
