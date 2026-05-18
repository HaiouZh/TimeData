import { CategorySchema } from "@timedata/shared";
import { requestJson, type ApiConfig } from "../lib/api-client.js";

const CategoriesResponseSchema = CategorySchema.array();

export async function runCategories(config: ApiConfig, fetchImpl?: typeof fetch): Promise<unknown> {
  const raw = await requestJson(config, "/api/categories", { fetchImpl });
  if (raw && typeof raw === "object" && "ok" in raw && (raw as { ok: unknown }).ok === false) return raw;

  const parsed = CategoriesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "SCHEMA_MISMATCH",
        message: "Server returned categories in an unexpected shape",
        details: { issues: parsed.error.issues.slice(0, 5) },
      },
    };
  }

  const active = parsed.data.filter((category) => !category.isArchived);
  const byId = new Map(active.map((category) => [category.id, category]));
  return {
    ok: true,
    categories: active.map((category) => {
      const parent = category.parentId ? byId.get(category.parentId) : null;
      return {
        id: category.id,
        path: parent ? `${parent.name}/${category.name}` : category.name,
        name: category.name,
        parentId: category.parentId,
      };
    }),
  };
}
