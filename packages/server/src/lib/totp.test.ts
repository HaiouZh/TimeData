import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, totpCode, verifyTotpCode } from "./totp.js";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totpCode", () => {
  // RFC 6238 Appendix B 向量(8 位截取后 6 位)
  it.each([
    [59_000, "287082"],
    [1_111_111_109_000, "081804"],
    [1_234_567_890_000, "005924"],
  ])("time=%d → %s", (timeMs, expected) => {
    expect(totpCode(RFC_SECRET, timeMs)).toBe(expected);
  });
});

describe("verifyTotpCode", () => {
  it("当期码通过", () => {
    expect(verifyTotpCode(RFC_SECRET, "287082", 59_000)).toBe(true);
  });
  it("相邻 ±1 步容差通过", () => {
    // 59s 属于步 1;步 2 的码在 60~89s 窗口,用 90s-1ms 之前一步校验
    expect(verifyTotpCode(RFC_SECRET, "287082", 89_000)).toBe(true);
  });
  it("隔两步的旧码拒绝", () => {
    expect(verifyTotpCode(RFC_SECRET, "287082", 59_000 + 90_000)).toBe(false);
  });
  it("错码/格式错拒绝", () => {
    expect(verifyTotpCode(RFC_SECRET, "000000", 59_000)).toBe(false);
    expect(verifyTotpCode(RFC_SECRET, "28708", 59_000)).toBe(false);
    expect(verifyTotpCode(RFC_SECRET, "abc123", 59_000)).toBe(false);
  });
});

describe("secret 与恢复码生成", () => {
  it("secret 是合法 base32 且可出码", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(totpCode(secret, 0)).toMatch(/^\d{6}$/);
  });
  it("otpauth URI 含 secret 与 label", () => {
    const uri = otpauthUri("ABCD2345ABCD2345ABCD2345ABCD2345", "TimeData");
    expect(uri).toBe(
      "otpauth://totp/TimeData?secret=ABCD2345ABCD2345ABCD2345ABCD2345&issuer=TimeData&algorithm=SHA1&digits=6&period=30",
    );
  });
  it("恢复码格式与去重", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(new Set(codes).size).toBe(10);
  });
});
