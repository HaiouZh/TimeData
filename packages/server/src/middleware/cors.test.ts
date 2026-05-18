import { describe, expect, it } from "vitest";
import { allowedOriginsFromEnv } from "./cors.js";

describe("allowedOriginsFromEnv", () => {
  it("defaults to empty array when ALLOWED_ORIGINS is not set", () => {
    expect(allowedOriginsFromEnv({})).toEqual([]);
  });

  it('returns ["*"] when ALLOWED_ORIGINS is set to "*"', () => {
    expect(allowedOriginsFromEnv({ ALLOWED_ORIGINS: "*" })).toEqual(["*"]);
  });

  it("parses comma-separated origins and trims whitespace", () => {
    expect(
      allowedOriginsFromEnv({
        ALLOWED_ORIGINS: " https://app.example.com,capacitor://localhost , http://localhost:5173 ",
      }),
    ).toEqual(["https://app.example.com", "capacitor://localhost", "http://localhost:5173"]);
  });

  it("filters empty entries", () => {
    expect(
      allowedOriginsFromEnv({
        ALLOWED_ORIGINS: "https://app.example.com,, ,capacitor://localhost,",
      }),
    ).toEqual(["https://app.example.com", "capacitor://localhost"]);
  });
});
