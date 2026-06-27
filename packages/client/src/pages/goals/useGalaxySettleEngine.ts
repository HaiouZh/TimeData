import { useCallback, useEffect, useMemo, useRef } from "react";
import type { XY } from "../../lib/goalGalaxyLayout.js";
import type { GalaxySettleInput, GalaxySettleSim } from "../../lib/goalGalaxySettle.js";

const DRAG_REHEAT_ALPHA = 0.3;
export function useGalaxySettleEngine(args: {
  enabled: boolean;
  input: GalaxySettleInput;
  live: boolean;
  onPositions: (positions: Record<string, XY>) => void;
}): { reheat: () => void; setDragPin: (id: string, pos: XY | null) => void } {
  const { enabled, input, live, onPositions } = args;
  const simRef = useRef<GalaxySettleSim | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const inputRef = useRef(input);
  const liveRef = useRef(live);
  const onPositionsRef = useRef(onPositions);
  inputRef.current = input;
  liveRef.current = live;
  onPositionsRef.current = onPositions;

  const ensureRunning = useCallback(() => {
    if (rafRef.current !== null) return;
    const step = (): void => {
      const sim = simRef.current;
      if (!activeRef.current || !sim) {
        rafRef.current = null;
        return;
      }
      const { positions } = sim.tick();
      onPositionsRef.current(positions);
      if (sim.isSettled() && !liveRef.current) {
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    activeRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    void import("../../lib/goalGalaxySettle.js").then(({ createGalaxySettleSim }) => {
      if (!activeRef.current || generationRef.current !== generation) return;
      simRef.current?.stop();
      simRef.current = createGalaxySettleSim(inputRef.current);
      simRef.current.setLive(liveRef.current);
      ensureRunning();
    });

    return () => {
      activeRef.current = false;
      generationRef.current += 1;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      simRef.current?.stop();
      simRef.current = null;
    };
  }, [enabled, ensureRunning]);

  useEffect(() => {
    if (!enabled) return;
    simRef.current?.syncModel(input);
  }, [enabled, input]);

  useEffect(() => {
    if (!enabled) return;
    const sim = simRef.current;
    if (!sim) return;
    sim.setLive(live);
    ensureRunning();
  }, [enabled, live, ensureRunning]);

  const reheat = useCallback(() => {
    simRef.current?.reheat();
    ensureRunning();
  }, [ensureRunning]);

  const setDragPin = useCallback(
    (id: string, pos: XY | null) => {
      const sim = simRef.current;
      if (!sim) return;
      sim.setDragPin(id, pos);
      sim.reheat(DRAG_REHEAT_ALPHA);
      ensureRunning();
    },
    [ensureRunning],
  );

  return useMemo(() => ({ reheat, setDragPin }), [reheat, setDragPin]);
}
