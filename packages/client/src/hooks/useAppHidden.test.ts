import { describe, expect, it, vi } from "vitest";
import { subscribeWebAppHidden } from "./useAppHidden.js";

type Listener = (event: Event) => void;

class FakeTarget {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) || new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string) {
    for (const listener of this.listeners.get(type) || []) listener(new Event(type));
  }
}

class FakeDocument extends FakeTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

describe("subscribeWebAppHidden", () => {
  it("转为 hidden 与 pagehide 通知；转为 visible 不通知", () => {
    const doc = new FakeDocument();
    const win = new FakeTarget();
    const onHidden = vi.fn();
    subscribeWebAppHidden(onHidden, { document: doc, window: win });

    doc.visibilityState = "visible";
    doc.dispatch("visibilitychange");
    expect(onHidden).not.toHaveBeenCalled();

    doc.visibilityState = "hidden";
    doc.dispatch("visibilitychange");
    win.dispatch("pagehide");
    expect(onHidden).toHaveBeenCalledTimes(2);
  });

  it("退订后不再通知", () => {
    const doc = new FakeDocument();
    const win = new FakeTarget();
    const onHidden = vi.fn();
    const unsubscribe = subscribeWebAppHidden(onHidden, { document: doc, window: win });
    unsubscribe();
    doc.visibilityState = "hidden";
    doc.dispatch("visibilitychange");
    win.dispatch("pagehide");
    expect(onHidden).not.toHaveBeenCalled();
  });
});
