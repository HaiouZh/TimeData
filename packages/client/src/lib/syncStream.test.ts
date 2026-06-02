import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSyncStream, nextBackoffMs, parseSseChunk, type SyncStreamMessage } from "./syncStream.js";

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function streamingResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("parseSseChunk", () => {
  it("parses a complete event and returns it", () => {
    const { events, rest } = parseSseChunk('event: hello\ndata: {"latestSeq":3}\n\n');

    expect(events).toEqual([{ event: "hello", data: '{"latestSeq":3}' }]);
    expect(rest).toBe("");
  });

  it("keeps an incomplete trailing block in rest", () => {
    const { events, rest } = parseSseChunk('event: bump\ndata: {"latestSeq":5}\n\nevent: bump\ndata: {"lat');

    expect(events).toEqual([{ event: "bump", data: '{"latestSeq":5}' }]);
    expect(rest).toBe('event: bump\ndata: {"lat');
  });

  it("ignores comment-only heartbeat blocks", () => {
    const { events, rest } = parseSseChunk(": ping\n\n");

    expect(events).toEqual([]);
    expect(rest).toBe("");
  });

  it("defaults event name to message when only data is present", () => {
    const { events } = parseSseChunk("data: hi\n\n");

    expect(events).toEqual([{ event: "message", data: "hi" }]);
  });

  it("supports CRLF-delimited stream chunks", () => {
    const { events } = parseSseChunk("event: bump\r\ndata: 1\r\n\r\n");

    expect(events).toEqual([{ event: "bump", data: "1" }]);
  });
});

describe("nextBackoffMs", () => {
  it("grows exponentially from 1s and caps at 30s with jitter", () => {
    expect(nextBackoffMs(0, () => 0)).toBe(1000);
    expect(nextBackoffMs(2, () => 0)).toBe(4000);
    expect(nextBackoffMs(20, () => 0)).toBe(30_000);
    expect(nextBackoffMs(20, () => 1)).toBe(37_500);
  });
});

describe("createSyncStream", () => {
  it("connects with Authorization header and delivers hello messages", async () => {
    localStorage.setItem("timedata_api_url", "https://example.com/");
    localStorage.setItem("timedata_api_token", "tk");
    const fetchMock = vi.fn(async () => streamingResponse(['event: hello\ndata: {"latestSeq":2}\n\n']));
    const states: string[] = [];
    const messages: SyncStreamMessage[] = [];

    const stream = createSyncStream({
      fetchImpl: fetchMock,
      onStateChange: (state) => states.push(state),
      onMessage: (message) => messages.push(message),
    });
    stream.start();
    await vi.waitFor(() => expect(messages).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/api/sync/stream", expect.any(Object));
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tk");
    expect(states).toContain("connecting");
    expect(states).toContain("connected");
    expect(messages[0]).toEqual({ event: "hello", data: '{"latestSeq":2}' });
  });

  it("backs off and reconnects after a failed stream", async () => {
    vi.useFakeTimers();
    localStorage.setItem("timedata_api_url", "https://example.com");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(streamingResponse(['event: hello\ndata: {"latestSeq":3}\n\n']));
    const messages: SyncStreamMessage[] = [];

    const stream = createSyncStream({
      fetchImpl: fetchMock,
      onStateChange: () => undefined,
      onMessage: (message) => messages.push(message),
    });
    stream.start();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1300);
    await vi.waitFor(() => expect(messages).toEqual([{ event: "hello", data: '{"latestSeq":3}' }]));
    stream.stop();
  });
});
