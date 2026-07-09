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
}

export interface DiaryDoc {
  content: string;
  mtime: number | null;
}

function isConflict(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409;
}

function extractMtime(err: ApiError): number | null {
  const body = err.body as { mtime?: unknown } | null;
  return typeof body?.mtime === "number" ? body.mtime : null;
}

export const fetchDiaryConfig = () => apiFetch<DiaryConfig>("/api/diary/config");

export const saveDiaryTemplate = async (template: string): Promise<void> => {
  await apiFetch("/api/diary/config", { method: "PUT", body: JSON.stringify({ template }) });
};

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
    throw err;
  }
}
