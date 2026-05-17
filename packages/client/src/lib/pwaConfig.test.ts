import { describe, expect, it } from "vitest";
import { createPwaOptions } from "../../vite.config";

describe("createPwaOptions", () => {
  it("keeps full URL API routes network-only", () => {
    const options = createPwaOptions();
    const cacheRule = options.workbox?.runtimeCaching?.[0];
    const matcher = cacheRule?.urlPattern;

    expect(cacheRule?.handler).toBe("NetworkOnly");
    expect(typeof matcher).toBe("function");
    expect((matcher as ({ url }: { url: URL }) => boolean)({ url: new URL("https://example.com/api/sync/status") })).toBe(true);
    expect((matcher as ({ url }: { url: URL }) => boolean)({ url: new URL("https://example.com/assets/app.js") })).toBe(false);
  });
});
