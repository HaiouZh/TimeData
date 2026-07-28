import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api.ts";
import { callWithTotp, TotpCancelledError } from "./totpChallenge.ts";

function totpError(kind: "totp_required" | "totp_invalid"): ApiError {
  return new ApiError(401, "Unauthorized", JSON.stringify({ error: kind }), { error: kind });
}

describe("callWithTotp", () => {
  it("未绑定/无需码：裸调直通，不弹码", async () => {
    const request = vi.fn().mockResolvedValue("ok");
    const prompt = vi.fn();

    await expect(callWithTotp(request, prompt)).resolves.toBe("ok");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({});
    expect(prompt).not.toHaveBeenCalled();
  });

  it("totp_required：弹码后带 X-TOTP-Code 头重试成功", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(totpError("totp_required"))
      .mockResolvedValueOnce("done");
    const prompt = vi.fn().mockResolvedValue("123456");

    await expect(callWithTotp(request, prompt)).resolves.toBe("done");
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith({ retry: false });
    expect(request).toHaveBeenNthCalledWith(2, { "X-TOTP-Code": "123456" });
  });

  it("totp_invalid：提示重输，最多 3 次后抛最后一次错误", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(totpError("totp_required"))
      .mockRejectedValueOnce(totpError("totp_invalid"))
      .mockRejectedValueOnce(totpError("totp_invalid"))
      .mockRejectedValueOnce(totpError("totp_invalid"));
    const prompt = vi.fn().mockResolvedValue("000000");

    await expect(callWithTotp(request, prompt)).rejects.toMatchObject({
      body: { error: "totp_invalid" },
    });
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(prompt).toHaveBeenNthCalledWith(1, { retry: false });
    expect(prompt).toHaveBeenNthCalledWith(2, { retry: true });
    expect(prompt).toHaveBeenNthCalledWith(3, { retry: true });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("错码 2 次后输对：第 3 次成功返回", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(totpError("totp_required"))
      .mockRejectedValueOnce(totpError("totp_invalid"))
      .mockRejectedValueOnce(totpError("totp_invalid"))
      .mockResolvedValueOnce("finally");
    const prompt = vi.fn()
      .mockResolvedValueOnce("111111")
      .mockResolvedValueOnce("222222")
      .mockResolvedValueOnce("333333");

    await expect(callWithTotp(request, prompt)).resolves.toBe("finally");
    expect(request).toHaveBeenNthCalledWith(4, { "X-TOTP-Code": "333333" });
  });

  it("用户取消（prompt 返回 null）：抛 TotpCancelledError 而非原始 401", async () => {
    const original = totpError("totp_required");
    const request = vi.fn().mockRejectedValue(original);
    const prompt = vi.fn().mockResolvedValue(null);

    const rejection = await callWithTotp(request, prompt).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(TotpCancelledError);
    expect(rejection).not.toBe(original);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("重试中冒出非 totp 错误：原样抛出，不再弹码", async () => {
    const boom = new ApiError(500, "Internal", "", { error: "boom" });
    const request = vi.fn()
      .mockRejectedValueOnce(totpError("totp_required"))
      .mockRejectedValueOnce(boom);
    const prompt = vi.fn().mockResolvedValue("123456");

    await expect(callWithTotp(request, prompt)).rejects.toBe(boom);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("首调非 totp 错误：原样抛出，不弹码", async () => {
    const err = new Error("network down");
    const request = vi.fn().mockRejectedValue(err);
    const prompt = vi.fn();

    await expect(callWithTotp(request, prompt)).rejects.toBe(err);
    expect(prompt).not.toHaveBeenCalled();
  });
});
