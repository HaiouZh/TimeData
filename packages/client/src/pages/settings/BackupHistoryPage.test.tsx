import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import BackupHistoryPage from "./BackupHistoryPage.js";

describe("BackupHistoryPage", () => {
  it("shows backup timestamps and a separate restore button", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <BackupHistoryPage
          initialRecords={[
            {
              id: "backup-1",
              createdAt: "2026-05-08T08:00:00.000Z",
              categories: [
                {
                  id: "cat-1",
                  name: "Work",
                  parentId: null,
                  color: "#3366ff",
                  icon: null,
                  sortOrder: 1,
                  isArchived: false,
                  createdAt: "2026-05-08T08:00:00.000Z",
                  updatedAt: "2026-05-08T08:00:00.000Z",
                },
              ],
              timeEntries: [
                {
                  id: "entry-1",
                  categoryId: "cat-1",
                  startTime: "2026-05-08T09:00:00.000Z",
                  endTime: "2026-05-08T10:00:00.000Z",
                  note: null,
                  createdAt: "2026-05-08T09:00:00.000Z",
                  updatedAt: "2026-05-08T09:00:00.000Z",
                },
              ],
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(html).toContain("自动备份");
    expect(html).toContain("2026-05-08 16:00:00 UTC+8");
    expect(html).toContain("1 个分类，1 条记录");
    expect(html).toContain("恢复");
  });
});
