import { describe, expect, it } from "vitest";
import { validateServerUrl } from "./url.js";

describe("validateServerUrl", () => {
  it("accepts http and https URLs", () => {
    expect(validateServerUrl("http://server.example")).toBe("http://server.example");
    expect(validateServerUrl("https://server.example")).toBe("https://server.example");
  });

  it("rejects file URLs", () => {
    expect(validateServerUrl("file:///tmp/server.json")).toBeNull();
  });

  it("rejects values without a scheme", () => {
    expect(validateServerUrl("server.example")).toBeNull();
  });
});
