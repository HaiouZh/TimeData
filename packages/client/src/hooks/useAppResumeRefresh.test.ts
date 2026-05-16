import { describe, expect, it, vi } from "vitest";
import { subscribeWebAppResumeRefresh } from "./useAppResumeRefresh.js";

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
  visibilityState: DocumentVisibilityState = "hidden";
}

describe("subscribeWebAppResumeRefresh", () => {
  it("notifies when the document becomes visible, the window gains focus, or a bfcache page is shown", () => {
    const fakeDocument = new FakeDocument();
    const fakeWindow = new FakeTarget();
    const onResume = vi.fn();

    subscribeWebAppResumeRefresh(onResume, { document: fakeDocument, window: fakeWindow });

    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatch("visibilitychange");
    expect(onResume).not.toHaveBeenCalled();

    fakeDocument.visibilityState = "visible";
    fakeDocument.dispatch("visibilitychange");
    fakeWindow.dispatch("focus");
    fakeWindow.dispatch("pageshow", Object.assign(new Event("pageshow"), { persisted: true }));

    expect(onResume).toHaveBeenCalledTimes(3);
  });

  it("removes listeners when disposed", () => {
    const fakeDocument = new FakeDocument();
    const fakeWindow = new FakeTarget();
    const onResume = vi.fn();

    const dispose = subscribeWebAppResumeRefresh(onResume, { document: fakeDocument, window: fakeWindow });
    dispose();

    fakeDocument.visibilityState = "visible";
    fakeDocument.dispatch("visibilitychange");
    fakeWindow.dispatch("focus");

    expect(onResume).not.toHaveBeenCalled();
  });
});
