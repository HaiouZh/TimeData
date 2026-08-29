import type { AuthTokenTier } from "./middleware/auth.js";

/**
 * Hono 应用的 context 变量契约——`c.set()` / `c.get()` 能放什么、取出来是什么类型。
 *
 * 独立成文件而不是留在 `index.ts`：测试要建自己的 Hono 实例来隔离中间件，裸 `new Hono()`
 * 拿不到这份声明，`c.set("tokenTier", …)` 就成了类型错误——而 `index.ts` 有启动副作用，
 * 测试不能为了一个类型去 import 它。放这里两边共用同一份，中间件写进去什么、路由取出来什么，
 * 只有一处真相。
 */
export type ServerEnv = {
  Variables: {
    secureHeadersNonce?: string;
    tokenTier?: AuthTokenTier;
  };
};
