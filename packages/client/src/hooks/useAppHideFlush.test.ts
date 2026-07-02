// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { subscribeWebAppHide } from "./useAppHideFlush.js";

type Listener = (event: Event) => void;

class FakeTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) || new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event = new Event(type)) {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

class FakeDocument extends FakeTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

describe("subscribeWebAppHide", () => {
  it("notifies when the document becomes hidden or the page is unloaded via pagehide", () => {
    const fakeDocument = new FakeDocument();
    const fakeWindow = new FakeTarget();
    const onHide = vi.fn();

    subscribeWebAppHide(onHide, { document: fakeDocument, window: fakeWindow });

    fakeDocument.visibilityState = "visible";
    fakeDocument.dispatch("visibilitychange");
    expect(onHide).not.toHaveBeenCalled();

    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatch("visibilitychange");
    expect(onHide).toHaveBeenCalledTimes(1);

    fakeWindow.dispatch("pagehide");
    expect(onHide).toHaveBeenCalledTimes(2);
  });

  it("removes listeners when disposed", () => {
    const fakeDocument = new FakeDocument();
    const fakeWindow = new FakeTarget();
    const onHide = vi.fn();

    const dispose = subscribeWebAppHide(onHide, { document: fakeDocument, window: fakeWindow });
    dispose();

    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatch("visibilitychange");
    fakeWindow.dispatch("pagehide");

    expect(onHide).not.toHaveBeenCalled();
  });
});
