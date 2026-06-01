import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { QuickNotesFile } from "./schema.js";

function safeTimestamp(value: string): string {
  return value.replace(/:/g, "-").replace(/\.\d{3}Z$/, "");
}

export function quickNotesBackupFileName(exportedAt: string): string {
  return `timedata-quick-notes-${safeTimestamp(exportedAt)}.backup.json`;
}

export function quickNotesMarkdownFileName(dateLabel: string): string {
  return `timedata-quick-notes-${dateLabel}.md`;
}

function saveInBrowser(fileName: string, data: string, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveOnNative(fileName: string, data: string, title: string): Promise<void> {
  const writeResult = await Filesystem.writeFile({
    path: fileName,
    data,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  const canShare = await Share.canShare().catch(() => ({ value: false }));
  if (!canShare.value) return;

  try {
    await Share.share({
      title,
      text: fileName,
      url: writeResult.uri,
      dialogTitle: "保存或分享速记",
    });
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) return;
    throw error;
  }
}

export async function downloadQuickNotesJson(backup: QuickNotesFile): Promise<void> {
  const fileName = quickNotesBackupFileName(backup.exportedAt);
  const data = JSON.stringify(backup, null, 2);
  if (Capacitor.isNativePlatform()) {
    await saveOnNative(fileName, data, "TimeData 速记备份");
    return;
  }
  saveInBrowser(fileName, data, "application/json");
}

export async function downloadQuickNotesMarkdown(markdown: string, dateLabel: string): Promise<void> {
  const fileName = quickNotesMarkdownFileName(dateLabel);
  if (Capacitor.isNativePlatform()) {
    await saveOnNative(fileName, markdown, "TimeData 速记");
    return;
  }
  saveInBrowser(fileName, markdown, "text/markdown");
}
