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
  const sorted = [...active].sort((a, b) => {
    const parentA = a.parentId ? byId.get(a.parentId) : null;
    const parentB = b.parentId ? byId.get(b.parentId) : null;
    const parentOrderA = parentA?.sortOrder ?? a.sortOrder;
    const parentOrderB = parentB?.sortOrder ?? b.sortOrder;
    if (parentOrderA !== parentOrderB) return parentOrderA - parentOrderB;

    const parentIdA = parentA?.id ?? a.id;
    const parentIdB = parentB?.id ?? b.id;
    const parentIdOrder = parentIdA.localeCompare(parentIdB);
    if (parentIdOrder !== 0) return parentIdOrder;

    if (a.parentId === null && b.parentId !== null) return -1;
    if (a.parentId !== null && b.parentId === null) return 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;

    const nameOrder = a.name.localeCompare(b.name);
    if (nameOrder !== 0) return nameOrder;
    return a.id.localeCompare(b.id);
  });
  return {
    ok: true,
    categories: sorted.map((category) => {
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
