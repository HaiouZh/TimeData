import { describe, it, expect } from "vitest";
import { errorJson, ErrorCode } from "./errors.js";

describe("errorJson", () => {
  it("returns { ok: false, error: { code, message } } shape", () => {
    const { body, status } = errorJson(ErrorCode.INVALID_BODY, 400, "bad shape");
    expect(body).toEqual({ ok: false, error: { code: "INVALID_BODY", message: "bad shape" } });
    expect(status).toBe(400);
  });

  it("includes details when given", () => {
    const { body } = errorJson(ErrorCode.INVALID_BODY, 400, "bad", { issues: ["a"] });
    expect(body).toEqual({ ok: false, error: { code: "INVALID_BODY", message: "bad", details: { issues: ["a"] } } });
  });

  it("INTERNAL_ERROR default message", () => {
    const { body, status } = errorJson(ErrorCode.INTERNAL_ERROR, 500);
    expect(body).toEqual({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal error" } });
    expect(status).toBe(500);
  });
});
