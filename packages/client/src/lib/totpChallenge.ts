import { ApiError } from "./api.ts";

/**
 * 危险操作 TOTP 弹码重试链路。
 *
 * 服务端契约（middleware/totp.ts）：被锁路由缺 X-TOTP-Code 头 → 401 { error: "totp_required" }；
 * 码错 → 401 { error: "totp_invalid" }。未绑定时服务端直接放行，本模块的裸调也就直通。
 */

export interface TotpPromptOptions {
  /** true 表示上一次输入的码被服务端判错，弹窗应显示「验证码错误，请重新输入」。 */
  retry: boolean;
}

/** 返回用户输入的码；返回 null 表示用户取消。 */
export type TotpPrompt = (options: TotpPromptOptions) => Promise<string | null>;

// —— 命令式弹窗桥 ——
// 仓库现有弹窗（ConfirmSheet/Sheet）都是声明式受控组件，没有全局命令式弹窗惯例。
// 这里用「模块级 setter 注册 + Provider 挂载」：TotpPromptDialog 挂在 App 根部，
// mount 时把自己的 prompt 实现注册进来；callWithTotp 默认走这里。
let registeredPrompt: TotpPrompt | null = null;

export function registerTotpPrompt(prompt: TotpPrompt | null): void {
  registeredPrompt = prompt;
}

const defaultPrompt: TotpPrompt = (options) => {
  if (!registeredPrompt) {
    // 弹窗宿主没挂载（如纯逻辑测试环境）：视为用户取消，让调用方拿到原始错误。
    return Promise.resolve(null);
  }
  return registeredPrompt(options);
};

const MAX_CODE_ATTEMPTS = 3;

function isTotpError(error: unknown, kind: "totp_required" | "totp_invalid"): error is ApiError {
  if (!(error instanceof ApiError)) return false;
  const body = error.body;
  return typeof body === "object" && body !== null && (body as { error?: unknown }).error === kind;
}

/**
 * 先裸调（空 headers）；收到 totp_required 弹码带 X-TOTP-Code 重试；
 * totp_invalid 提示重输（最多 3 次后抛最后一次错误）；用户取消抛原始错误；其他错误原样抛。
 */
export async function callWithTotp<T>(
  request: (totpHeaders: Record<string, string>) => Promise<T>,
  prompt: TotpPrompt = defaultPrompt,
): Promise<T> {
  let originalError: unknown;
  try {
    return await request({});
  } catch (error) {
    if (!isTotpError(error, "totp_required")) throw error;
    originalError = error;
  }

  let lastInvalidError: unknown = originalError;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = await prompt({ retry: attempt > 0 });
    if (code === null) throw originalError;
    try {
      return await request({ "X-TOTP-Code": code });
    } catch (error) {
      if (!isTotpError(error, "totp_invalid")) throw error;
      lastInvalidError = error;
    }
  }
  throw lastInvalidError;
}
