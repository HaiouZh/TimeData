import { ApiError, apiFetch } from "../api.js";

/** 日记保存冲突：服务器端内容在 baseMtime 之后被修改过，携带服务器当前 mtime 供前端决策 */
export class DiaryConflictError extends Error {
  mtime: number | null;
  constructor(mtime: number | null) {
    super("日记已被其他窗口修改");
    this.name = "DiaryConflictError";
    this.mtime = mtime;
  }
}

export interface DiaryConfig {
  enabled: boolean;
  template: string;
  weeklyTemplate: string;
  guideItems: string;
}

/** 批量读接口的单条结果：是否存在及内容 */
export interface DiaryBatchEntry {
  exists: boolean;
  content: string;
}

/** 批量读接口响应：日 key/周 key 各自的映射，以及周记模板是否已配置 */
export interface DiaryBatchResult {
  dates: Record<string, DiaryBatchEntry>;
  weeks: Record<string, DiaryBatchEntry>;
  weeklyConfigured: boolean;
}

export interface DiaryDoc {
  content: string;
  mtime: number | null;
}

function isConflict(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    (err.body as { error?: unknown } | null)?.error === "diary-conflict"
  );
}

function extractMtime(err: ApiError): number | null {
  const body = err.body as { mtime?: unknown } | null;
  return typeof body?.mtime === "number" ? body.mtime : null;
}

function isVaultNotWritable(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 503 &&
    (err.body as { error?: unknown } | null)?.error === "diary-vault-not-writable"
  );
}

export const fetchDiaryConfig = () => apiFetch<DiaryConfig>("/api/diary/config");

export const saveDiaryTemplate = async (template: string): Promise<void> => {
  await apiFetch("/api/diary/config", { method: "PUT", body: JSON.stringify({ template }) });
};

export const saveDiaryWeeklyTemplate = async (weeklyTemplate: string): Promise<void> => {
  await apiFetch("/api/diary/config", { method: "PUT", body: JSON.stringify({ weeklyTemplate }) });
};

export const saveDiaryGuideItems = async (guideItems: string): Promise<void> => {
  await apiFetch("/api/diary/config", { method: "PUT", body: JSON.stringify({ guideItems }) });
};

/** 批量读日记内容：一次请求获取多个日期/周的内容，供回顾页拼装用 */
export const fetchDiaryBatch = (body: { dates?: string[]; weeks?: string[] }) =>
  apiFetch<DiaryBatchResult>("/api/diary/batch", { method: "POST", body: JSON.stringify(body) });

export const fetchDiary = (date: string) => apiFetch<DiaryDoc>(`/api/diary/${date}`);

export async function saveDiary(
  date: string,
  body: { content: string; baseMtime: number | null; force?: boolean },
): Promise<{ mtime: number }> {
  try {
    return await apiFetch<{ mtime: number }>(`/api/diary/${date}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (isConflict(err)) throw new DiaryConflictError(extractMtime(err));
    if (isVaultNotWritable(err)) {
      throw new Error("服务器日记 vault 无写权限，请检查 DIARY_VAULT_HOST_DIR 挂载目录的所有权");
    }
    throw err;
  }
}
