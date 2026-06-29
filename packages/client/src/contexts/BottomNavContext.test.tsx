// @vitest-environment jsdom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { renderDom, unmount } from "../test/domHarness.js";
import { BottomNavProvider, useBottomNav } from "./BottomNavContext.js";

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

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("BottomNavContext", () => {
  it("updates the hidden state from descendants", async () => {
    const { host, root } = await renderDom(createElement(BottomNavProvider, null, createElement(Harness)));

    expect(host.querySelector('[data-testid="hidden"]')?.textContent).toBe("false");
    await act(async () => {
      (host.querySelector("button") as HTMLButtonElement).click();
    });

    expect(host.querySelector('[data-testid="hidden"]')?.textContent).toBe("true");

    await unmount(root);
  });

  it("throws outside the provider", async () => {
    expect(() => renderToStaticMarkup(createElement(OutsideProviderHarness))).toThrow(
      "useBottomNav must be used within BottomNavProvider",
    );
  });
});
