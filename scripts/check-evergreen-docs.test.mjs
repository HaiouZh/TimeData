import assert from "node:assert/strict";
import test from "node:test";

import { hasStaleDataModelCategoriesPageReference } from "./check-evergreen-docs.mjs";

test("flags stale data-model reference when settings category pages change", () => {
  const changedFiles = [
    "packages/client/src/pages/settings/SettingsCategoriesPage.tsx",
    "packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx",
  ];

  assert.equal(
    hasStaleDataModelCategoriesPageReference(changedFiles, "旧路径仍是 packages/client/src/pages/CategoriesPage.tsx"),
    true,
  );
});

test("ignores data-model after the old page path is removed", () => {
  const changedFiles = [
    "packages/client/src/pages/settings/SettingsCategoriesPage.tsx",
    "packages/client/src/pages/settings/SettingsCategoryDetailPage.tsx",
  ];

  assert.equal(
    hasStaleDataModelCategoriesPageReference(
      changedFiles,
      "SettingsCategoriesPage.tsx / SettingsCategoryDetailPage.tsx",
    ),
    false,
  );
});
