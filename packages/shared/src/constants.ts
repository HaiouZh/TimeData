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

  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const def = DEFAULT_CATEGORIES[i];
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

    for (let j = 0; j < def.children.length; j++) {
      categories.push({
        id: def.children[j].id,
        name: def.children[j].name,
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

export const DAY_START_HOUR = 0;

export const SYNC_DIAGNOSTIC_FAILURE_THRESHOLD = 3;
