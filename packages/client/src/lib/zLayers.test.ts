import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Z } from "./zLayers.js";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("z layer mirror", () => {
  it("matches the css --z-* ladder", () => {
    expect(Z).toEqual({ dropdown: 30, backdrop: 40, modal: 50, top: 70 });
    for (const [k, v] of Object.entries(Z)) expect(css).toContain(`--z-${k}: ${v};`);
  });
});
