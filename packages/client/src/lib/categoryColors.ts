export const CATEGORY_COLOR_PALETTES = {
  classic: {
    label: "经典",
    colors: [
      "#4A90D9",
      "#50E3C2",
      "#7ED321",
      "#F5A623",
      "#D0021B",
      "#9013FE",
      "#BD10E0",
      "#417505",
      "#F8E71C",
      "#B8E986",
      "#4A4A4A",
      "#9B9B9B",
      "#2E86AB",
      "#F26419",
    ],
  },
  morandi: {
    label: "莫兰迪",
    colors: [
      "#8E9AAF",
      "#CBC0D3",
      "#EFD3D7",
      "#FEEAFA",
      "#DEE2FF",
      "#A3B18A",
      "#B7B7A4",
      "#CB997E",
      "#DDBEA9",
      "#FFE8D6",
      "#6B705C",
      "#A5A58D",
      "#B5838D",
      "#6D6875",
    ],
  },
  macaron: {
    label: "马卡龙",
    colors: [
      "#FFADAD",
      "#FFD6A5",
      "#FDFFB6",
      "#CAFFBF",
      "#9BF6FF",
      "#A0C4FF",
      "#BDB2FF",
      "#FFC6FF",
      "#FFFFFC",
      "#F1C0E8",
      "#CFBAF0",
      "#A3C4F3",
      "#90DBF4",
      "#98F5E1",
    ],
  },
} as const;

export type CategoryColorPaletteId = keyof typeof CATEGORY_COLOR_PALETTES;

export function normalizeCategoryColor(color: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw new Error("颜色格式不正确。");
  }

  return color.toUpperCase();
}

export function applyCategoryPaletteByIndex(paletteId: CategoryColorPaletteId, index: number): string {
  const colors = CATEGORY_COLOR_PALETTES[paletteId].colors;
  const normalizedIndex = ((index % colors.length) + colors.length) % colors.length;
  return colors[normalizedIndex];
}
