import type { Category } from "./types.js";

type DefaultCategory = Pick<Category, "name" | "color"> & {
  id: string;
  children: (Pick<Category, "name"> & { id: string })[];
};

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    id: "cat-sleep",
    name: "睡眠",
    color: "#708090",
    children: [
      { id: "cat-sleep-sleep", name: "睡眠" },
      { id: "cat-sleep-nap", name: "小睡" },
    ],
  },
  {
    id: "cat-survival",
    name: "生存",
    color: "#50C878",
    children: [
      { id: "cat-survival-eat", name: "吃喝" },
      { id: "cat-survival-wash", name: "洗漱" },
      { id: "cat-survival-other", name: "其他" },
    ],
  },
  {
    id: "cat-invest",
    name: "投资",
    color: "#7B68EE",
    children: [
      { id: "cat-invest-read", name: "读书" },
      { id: "cat-invest-vocab", name: "背单词" },
      { id: "cat-invest-review", name: "记录复盘" },
      { id: "cat-invest-run", name: "跑步" },
      { id: "cat-invest-exercise", name: "锻炼" },
      { id: "cat-invest-meditate", name: "冥想" },
    ],
  },
  {
    id: "cat-leisure",
    name: "享乐",
    color: "#FFB347",
    children: [{ id: "cat-leisure-fun", name: "娱乐" }],
  },
  {
    id: "cat-ops",
    name: "运转",
    color: "#4A90D9",
    children: [
      { id: "cat-ops-commute", name: "通勤" },
      { id: "cat-ops-chores", name: "家务" },
    ],
  },
];

export function createDefaultCategories(timestamp = new Date().toISOString()): Category[] {
  const categories: Category[] = [];

  for (const [i, def] of DEFAULT_CATEGORIES.entries()) {
    categories.push({
      id: def.id,
      name: def.name,
      parentId: null,
      color: def.color,
      icon: null,
      sortOrder: i,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    for (const [j, child] of def.children.entries()) {
      categories.push({
        id: child.id,
        name: child.name,
        parentId: def.id,
        color: def.color,
        icon: null,
        sortOrder: j,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return categories;
}

// 无色分类（未设色或父分类缺失）在统计/图表里的回退色。属于用户内容色域，
// 取冷中性灰（镜像 index.css 的 --color-ink-3），与深冷工具盘协调。
export const UNCATEGORIZED_COLOR = "#8b94a8";

export const DAY_START_HOUR = 0;

export const SYNC_DIAGNOSTIC_FAILURE_THRESHOLD = 3;
