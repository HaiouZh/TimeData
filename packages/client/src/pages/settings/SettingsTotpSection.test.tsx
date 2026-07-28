// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import SettingsTotpSection from "./SettingsTotpSection.js";

const fetchTotpStatus = vi.hoisted(() => vi.fn());
const setupTotp = vi.hoisted(() => vi.fn());
const confirmTotp = vi.hoisted(() => vi.fn());
const disableTotp = vi.hoisted(() => vi.fn());

vi.mock("../../lib/adminApi.ts", () => ({
  fetchTotpStatus,
  setupTotp,
  confirmTotp,
  disableTotp,
}));

const toDataURL = vi.hoisted(() => vi.fn());
vi.mock("qrcode", () => ({ default: { toDataURL } }));

const setupResponse = {
  secret: "ABCD2345ABCD2345ABCD2345ABCD2345",
  otpauthUri:
    "otpauth://totp/TimeData?secret=ABCD2345ABCD2345ABCD2345ABCD2345&issuer=TimeData&algorithm=SHA1&digits=6&period=30",
  recoveryCodes: ["aaaa-1111", "bbbb-2222"],
};

function findButton(host: ParentNode, text: string) {
  return Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes(text));
}

async function typeInto(input: Element | null | undefined, value: string) {
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("SettingsTotpSection", () => {
  it("未绑定时显示启用按钮，不显示停用入口", async () => {
    fetchTotpStatus.mockResolvedValue({ enrolled: false });
    const { host, root } = await renderDom(createElement(SettingsTotpSection));

    expect(host.textContent).toContain("两步验证锁");
    expect(host.textContent).toContain("两步锁未启用");
    expect(findButton(host, "启用两步锁")).not.toBeUndefined();
    expect(findButton(host, "停用两步锁")).toBeUndefined();

    await unmount(root);
  });

  it("setup 后显示二维码、secret、恢复码与确认输入", async () => {
    fetchTotpStatus.mockResolvedValue({ enrolled: false });
    setupTotp.mockResolvedValue(setupResponse);
    toDataURL.mockResolvedValue("data:image/png;base64,QR");
    const { host, root } = await renderDom(createElement(SettingsTotpSection));

    await click(findButton(host, "启用两步锁"));

    expect(setupTotp).toHaveBeenCalled();
    expect(toDataURL).toHaveBeenCalledWith(setupResponse.otpauthUri);
    const img = host.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,QR");
    expect(host.textContent).toContain(setupResponse.secret);
    expect(host.textContent).toContain("aaaa-1111");
    expect(host.textContent).toContain("bbbb-2222");
    expect(host.textContent).toContain("同一二维码请同时扫进至少两处");
    expect(host.textContent).toContain("恢复码只显示这一次");
    expect(host.textContent).toContain("忘了全部");
    expect(host.querySelector("input[aria-label='确认绑定动态码']")).not.toBeNull();

    await unmount(root);
  });

  it("confirm 成功后显示已启用与停用入口", async () => {
    fetchTotpStatus.mockResolvedValue({ enrolled: false });
    setupTotp.mockResolvedValue(setupResponse);
    toDataURL.mockResolvedValue("data:image/png;base64,QR");
    confirmTotp.mockResolvedValue({ enrolled: true });
    const { host, root } = await renderDom(createElement(SettingsTotpSection));

    await click(findButton(host, "启用两步锁"));
    await typeInto(host.querySelector("input[aria-label='确认绑定动态码']"), "123456");
    await click(findButton(host, "确认绑定"));

    expect(confirmTotp).toHaveBeenCalledWith("123456");
    expect(host.textContent).toContain("两步锁已启用");
    expect(findButton(host, "停用两步锁")).not.toBeUndefined();
    // 确认成功后二维码/恢复码不再显示
    expect(host.textContent).not.toContain("aaaa-1111");

    await unmount(root);
  });

  it("confirm 错码显示错误提示且保持在绑定流程", async () => {
    fetchTotpStatus.mockResolvedValue({ enrolled: false });
    setupTotp.mockResolvedValue(setupResponse);
    toDataURL.mockResolvedValue("data:image/png;base64,QR");
    confirmTotp.mockRejectedValue(new Error("totp_invalid"));
    const { host, root } = await renderDom(createElement(SettingsTotpSection));

    await click(findButton(host, "启用两步锁"));
    await typeInto(host.querySelector("input[aria-label='确认绑定动态码']"), "000000");
    await click(findButton(host, "确认绑定"));

    expect(host.textContent).toContain("验证码错误");
    expect(host.querySelector("input[aria-label='确认绑定动态码']")).not.toBeNull();

    await unmount(root);
  });

  it("已启用时停用需输码，成功后回到未启用", async () => {
    fetchTotpStatus.mockResolvedValue({ enrolled: true });
    disableTotp.mockResolvedValue({ enrolled: false });
    const { host, root } = await renderDom(createElement(SettingsTotpSection));

    expect(host.textContent).toContain("两步锁已启用");
    await click(findButton(host, "停用两步锁"));

    const input = host.querySelector("input[aria-label='停用动态码']");
    expect(input).not.toBeNull();
    // 未输码时不调 disableTotp
    await click(findButton(host, "确认停用"));
    expect(disableTotp).not.toHaveBeenCalled();

    await typeInto(input, "654321");
    await click(findButton(host, "确认停用"));

    expect(disableTotp).toHaveBeenCalledWith("654321");
    expect(host.textContent).toContain("两步锁未启用");
    expect(findButton(host, "启用两步锁")).not.toBeUndefined();

    await unmount(root);
  });

  it("disable 错码显示错误提示并保持已启用", async () => {
    fetchTotpStatus.mockResolvedValue({ enrolled: true });
    disableTotp.mockRejectedValue(new Error("totp_invalid"));
    const { host, root } = await renderDom(createElement(SettingsTotpSection));

    await click(findButton(host, "停用两步锁"));
    await typeInto(host.querySelector("input[aria-label='停用动态码']"), "000000");
    await click(findButton(host, "确认停用"));

    expect(host.textContent).toContain("验证码错误");
    expect(host.textContent).toContain("两步锁已启用");

    await unmount(root);
  });
});
