import { requestJson, type ApiConfig } from "../lib/api-client.js";

interface CategoryResponseItem {
  id: string;
  name: string;
  parentId: string | null;
  isArchived: boolean;
}

export async function runCategories(config: ApiConfig, fetchImpl?: typeof fetch): Promise<unknown> {
  const categories = await requestJson(config, "/api/categories", { fetchImpl });
  if (!Array.isArray(categories)) return categories;

  const active = categories.filter((category): category is CategoryResponseItem => Boolean(category) && !category.isArchived);
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
