import { describe, expect, it } from "vitest";
import { createTokenStore } from "./confirm-token.js";

describe("createTokenStore", () => {
  it("creates and consumes a token payload once", () => {
    const store = createTokenStore<{ requestedAt: string }>(60_000);
    const { token, expiresAt } = store.create({ requestedAt: "2026-05-13T10:00:00.000Z" }, 1_000);

    expect(token).toEqual(expect.any(String));
    expect(expiresAt.toISOString()).toBe("1970-01-01T00:01:01.000Z");
    expect(store.consume(token, 2_000)).toEqual({ requestedAt: "2026-05-13T10:00:00.000Z" });
    expect(store.consume(token, 2_000)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const store = createTokenStore<{ id: string }>(1_000);
    const { token } = store.create({ id: "reset" }, 1_000);

    expect(store.consume(token, 2_001)).toBeNull();
  });
});
