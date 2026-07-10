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
export const STREAM_CONNECT_TIMEOUT_MS = 15_000;
export const STREAM_WATCHDOG_TIMEOUT_MS = 45_000;

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
  let state: SyncStreamState = "disconnected";
  let generationId = 0;
  let activeGeneration: StreamGeneration | null = null;
  const fetchImpl = options.fetchImpl ?? fetch;

  interface StreamRun {
    controller: AbortController;
    connectTimer: ReturnType<typeof setTimeout> | null;
    watchdogTimer: ReturnType<typeof setTimeout> | null;
  }

  interface StreamGeneration {
    id: number;
    active: boolean;
    reconnectAttempt: number;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    run: StreamRun | null;
  }

  function isCurrent(generation: StreamGeneration, run?: StreamRun): boolean {
    return generation.active && activeGeneration === generation && (run === undefined || generation.run === run);
  }

  function setState(nextState: SyncStreamState, generation?: StreamGeneration): void {
    if (generation && !isCurrent(generation)) return;
    if (state === nextState) return;
    state = nextState;
    options.onStateChange(nextState);
  }

  function clearRunTimers(run: StreamRun): void {
    if (run.connectTimer) {
      clearTimeout(run.connectTimer);
      run.connectTimer = null;
    }
    if (run.watchdogTimer) {
      clearTimeout(run.watchdogTimer);
      run.watchdogTimer = null;
    }
  }

  function armWatchdog(generation: StreamGeneration, run: StreamRun): void {
    if (run.watchdogTimer) clearTimeout(run.watchdogTimer);
    run.watchdogTimer = setTimeout(() => {
      if (isCurrent(generation, run)) run.controller.abort();
    }, STREAM_WATCHDOG_TIMEOUT_MS);
  }

  function scheduleReconnect(generation: StreamGeneration): void {
    if (!isCurrent(generation) || generation.reconnectTimer) return;
    const delayMs = nextBackoffMs(generation.reconnectAttempt);
    generation.reconnectAttempt += 1;
    generation.reconnectTimer = setTimeout(() => {
      generation.reconnectTimer = null;
      if (isCurrent(generation)) void runGeneration(generation);
    }, delayMs);
  }

  async function readLoop(generation: StreamGeneration, run: StreamRun): Promise<void> {
    const apiUrl = readApiUrl();
    if (!apiUrl) return;

    setState("connecting", generation);
    const headers = new Headers();
    const token = readToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    run.connectTimer = setTimeout(() => {
      if (isCurrent(generation, run)) run.controller.abort();
    }, STREAM_CONNECT_TIMEOUT_MS);
    const response = await fetchImpl(buildApiUrl(apiUrl, "/api/sync/stream"), {
      headers,
      signal: run.controller.signal,
    });
    if (run.connectTimer) {
      clearTimeout(run.connectTimer);
      run.connectTimer = null;
    }
    if (!isCurrent(generation, run)) {
      await response.body?.cancel().catch(() => undefined);
      return;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Sync stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rest = "";

    armWatchdog(generation, run);
    try {
      while (isCurrent(generation, run)) {
        const { value, done } = await reader.read();
        if (!isCurrent(generation, run)) break;
        armWatchdog(generation, run);
        if (done) break;

        const parsed = parseSseChunk(rest + decoder.decode(value, { stream: true }));
        rest = parsed.rest;

        for (const event of parsed.events) {
          if (event.event === "hello") {
            generation.reconnectAttempt = 0;
            setState("connected", generation);
          }
          if (isCurrent(generation, run)) options.onMessage(event);
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  async function runGeneration(generation: StreamGeneration): Promise<void> {
    if (!isCurrent(generation)) return;
    const run: StreamRun = {
      controller: new AbortController(),
      connectTimer: null,
      watchdogTimer: null,
    };
    generation.run = run;

    try {
      await readLoop(generation, run);
    } catch {
      // Reconnect below; callers observe the state machine instead of individual transport errors.
    } finally {
      clearRunTimers(run);
      if (generation.run === run) generation.run = null;
    }

    if (isCurrent(generation)) {
      setState("disconnected", generation);
      scheduleReconnect(generation);
    }
  }

  return {
    start() {
      if (activeGeneration?.active) return;
      const generation: StreamGeneration = {
        id: ++generationId,
        active: true,
        reconnectAttempt: 0,
        reconnectTimer: null,
        run: null,
      };
      activeGeneration = generation;
      void runGeneration(generation);
    },
    stop() {
      const generation = activeGeneration;
      activeGeneration = null;
      if (generation) {
        generation.active = false;
        if (generation.reconnectTimer) {
          clearTimeout(generation.reconnectTimer);
          generation.reconnectTimer = null;
        }
        if (generation.run) {
          clearRunTimers(generation.run);
          generation.run.controller.abort();
          generation.run = null;
        }
      }
      setState("disconnected");
    },
    getConnectionState() {
      return state;
    },
  };
}
