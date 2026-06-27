// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { useGalaxySettleEngine } from "./useGalaxySettleEngine.js";

const tickMock = vi.hoisted(() => vi.fn(() => ({ alpha: 0.001, positions: { "task:a": { x: 5, y: 6 } } })));
const stopMock = vi.hoisted(() => vi.fn());
const isSettledMock = vi.hoisted(() => vi.fn(() => true));
const reheatMock = vi.hoisted(() => vi.fn());
const setLiveMock = vi.hoisted(() => vi.fn());
const syncModelMock = vi.hoisted(() => vi.fn());
const setDragPinMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() =>
  vi.fn(() => ({
    tick: tickMock,
    stop: stopMock,
    isSettled: isSettledMock,
    reheat: reheatMock,
    setLive: setLiveMock,
    syncModel: syncModelMock,
    setDragPin: setDragPinMock,
  })),
);

vi.mock("../../lib/goalGalaxySettle.js", () => ({ createGalaxySettleSim: createMock, SETTLE_ALPHA_MIN: 0.02 }));

const input = {
  nodes: [{ id: "task:a", seed: { x: 0, y: 0 }, box: { width: 10, height: 10 }, fixed: false }],
  links: [],
  anchorById: {},
};

type Handlers = ReturnType<typeof useGalaxySettleEngine>;

let frame: FrameRequestCallback | null = null;

function Harness({
  enabled,
  live = true,
  onReady,
  onPositions = () => {},
}: {
  enabled: boolean;
  live?: boolean;
  onReady?: (handlers: Handlers) => void;
  onPositions?: (positions: Record<string, { x: number; y: number }>) => void;
}) {
  const handlers = useGalaxySettleEngine({ enabled, input, live, onPositions });
  onReady?.(handlers);
  return null;
}

async function flushImport(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
    await Promise.resolve();
  });
}

async function flushFrame(): Promise<void> {
  const callback = frame;
  frame = null;
  await act(async () => {
    callback?.(0);
  });
}

describe("useGalaxySettleEngine", () => {
  beforeEach(() => {
    createMock.mockClear();
    tickMock.mockClear();
    stopMock.mockClear();
    isSettledMock.mockClear();
    reheatMock.mockClear();
    setLiveMock.mockClear();
    syncModelMock.mockClear();
    setDragPinMock.mockClear();
    frame = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not load the simulation when disabled", async () => {
    const { root } = await renderDom(<Harness enabled={false} />);
    await flushImport();
    expect(createMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("builds a simulation when enabled and emits tick positions", async () => {
    const onPositions = vi.fn();
    const { root } = await renderDom(<Harness enabled live={false} onPositions={onPositions} />);
    await flushImport();
    await flushFrame();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(setLiveMock).toHaveBeenCalledWith(false);
    expect(onPositions).toHaveBeenCalledWith({ "task:a": { x: 5, y: 6 } });
    await unmount(root);
  });

  it("updates live mode without recreating the simulation", async () => {
    const { root } = await renderDom(<Harness enabled live={false} />);
    await flushImport();
    setLiveMock.mockClear();

    await act(async () => {
      root.render(<Harness enabled live />);
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(setLiveMock).toHaveBeenCalledWith(true);
    await unmount(root);
  });

  it("uses the latest live value when the simulation import resolves", async () => {
    const { root } = await renderDom(<Harness enabled live={false} />);

    await act(async () => {
      root.render(<Harness enabled live />);
    });
    await flushImport();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(setLiveMock).toHaveBeenCalledWith(true);
    await unmount(root);
  });

  it("restarts ticking when live mode is re-enabled after a frame was left pending", async () => {
    const { root } = await renderDom(<Harness enabled live={false} />);
    await flushImport();
    await flushFrame();
    expect(tickMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<Harness enabled live />);
    });
    await flushFrame();

    expect(setLiveMock).toHaveBeenCalledWith(true);
    expect(tickMock).toHaveBeenCalledTimes(2);
    await unmount(root);
  });

  it("stops the simulation and cancels animation frame on unmount", async () => {
    const { root } = await renderDom(<Harness enabled live={false} />);
    await flushImport();
    await unmount(root);

    expect(stopMock).toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it("reheats the simulation when a drag pin is set after freezing", async () => {
    let handlers: Handlers | null = null;
    const { root } = await renderDom(<Harness enabled live={false} onReady={(next) => (handlers = next)} />);
    await flushImport();
    await flushFrame();

    await act(async () => {
      handlers?.setDragPin("task:a", { x: 1, y: 2 });
    });

    expect(setDragPinMock).toHaveBeenCalledWith("task:a", { x: 1, y: 2 });
    expect(reheatMock).toHaveBeenCalledWith(0.3);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    await unmount(root);
  });

  it("keeps command handlers stable across rerenders", async () => {
    const seen: Handlers[] = [];
    const { root } = await renderDom(<Harness enabled live={false} onReady={(next) => seen.push(next)} />);
    const first = seen.at(-1);

    await act(async () => {
      root.render(<Harness enabled live={false} onReady={(next) => seen.push(next)} />);
    });

    expect(seen.at(-1)).toBe(first);
    await unmount(root);
  });
});
