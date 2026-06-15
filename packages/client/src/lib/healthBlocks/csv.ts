export interface TableColumn {
  id: string;
  label: string;
  unit?: string;
}

export interface TableCell {
  formatted: string;
  raw?: number | string | null;
}

export interface TableRow {
  id: string;
  cells: Record<string, TableCell>;
}

export interface TableData {
  columns: TableColumn[];
  rows: TableRow[];
}

function csvValue(value: string): string {
  const escaped = value.replace(/"/g, "\"\"");
  return /[",\n]/.test(value) ? `"${escaped}"` : escaped;
}

export function tableToCsv(table: TableData): string {
  const lines = [
    table.columns.map((column) => csvValue(column.label)).join(","),
    ...table.rows.map((row) => table.columns.map((column) => csvValue(row.cells[column.id]?.formatted ?? "")).join(",")),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

export function downloadCsv(filename: string, table: TableData): void {
  const blob = new Blob([tableToCsv(table)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]/g, "-");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
