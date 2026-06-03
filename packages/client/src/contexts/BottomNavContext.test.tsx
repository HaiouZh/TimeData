// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { BottomNavProvider, useBottomNav } from "./BottomNavContext.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  const { hidden, setHidden } = useBottomNav();
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "hidden" }, String(hidden)),
    createElement("button", { type: "button", onClick: () => setHidden(true) }, "hide"),
  );
}

function OutsideProviderHarness() {
  useBottomNav();
  return createElement("div");
}

async function render(element: ReactElement): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return { host, root };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("BottomNavContext", () => {
  it("updates the hidden state from descendants", async () => {
    const { host, root } = await render(createElement(BottomNavProvider, null, createElement(Harness)));

    expect(host.querySelector('[data-testid="hidden"]')?.textContent).toBe("false");
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
    });

    expect(host.querySelector('[data-testid="hidden"]')?.textContent).toBe("true");

    await act(async () => root.unmount());
  });

  it("throws outside the provider", async () => {
    expect(() => renderToStaticMarkup(createElement(OutsideProviderHarness))).toThrow(
      "useBottomNav must be used within BottomNavProvider",
    );
  });
});
