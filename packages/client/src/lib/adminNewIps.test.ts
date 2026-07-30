import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgeNewIp, fetchUnacknowledgedNewIps } from "./adminNewIps.js";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("./api.ts", () => ({ apiFetch }));

afterEach(() => {
  apiFetch.mockReset();
});

describe("adminNewIps", () => {
  it("fetchUnacknowledgedNewIps 请求未确认新来源列表", async () => {
    const response = {
      newIps: [
        {
          tokenTier: "master",
          scopeKey: "asn:9808|city:上海",
          country: "中国",
          city: "上海",
          asnOrg: "China Mobile",
          lastIp: "203.0.113.1",
          firstSeen: "2026-07-28T08:00:00.000Z",
          lastSeen: "2026-07-28T09:00:00.000Z",
        },
      ],
    };
    apiFetch.mockResolvedValue(response);

    await expect(fetchUnacknowledgedNewIps()).resolves.toEqual(response);
    expect(apiFetch).toHaveBeenCalledWith("/api/admin/request-logs/new-ips");
  });

  it("acknowledgeNewIp POST 确认指定 tier+scopeKey", async () => {
    apiFetch.mockResolvedValue({ ok: true });

    await acknowledgeNewIp("master", "asn:9808|city:上海");

    expect(apiFetch).toHaveBeenCalledWith("/api/admin/request-logs/new-ips/acknowledge", {
      method: "POST",
      body: JSON.stringify({ tokenTier: "master", scopeKey: "asn:9808|city:上海" }),
    });
  });
});
