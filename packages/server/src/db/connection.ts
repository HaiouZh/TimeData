import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// 惰性解析，不在模块加载期冻结：测试用 vi.stubEnv("DB_PATH", …) 隔离时，
// 本模块常常已被别的静态 import 链（如 sync/domains.ts → sync/seq.ts）先求值一遍，
// 加载期取值会让 stub 完全失效、悄悄落回下面这个共享磁盘路径。
function resolveDbPath(): string {
  return process.env.DB_PATH || path.join(process.cwd(), "data", "timedata.db");
}

let db: Database.Database | null = null;
let dbPath: string | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const target = resolveDbPath();
    // 默认磁盘库就是本机 dev server 正在写的那个文件：测试碰它会清掉真实同步账本，
    // 并发写还会撞 categories 外键（间歇性 FOREIGN KEY constraint failed）。这里直接拒绝，
    // 逼测试自己隔离：mock 本模块换 :memory: 库，或 vi.stubEnv("DB_PATH", <临时路径>)。
    if (process.env.VITEST && !process.env.DB_PATH) {
      throw new Error(
        `测试禁止打开默认磁盘库 ${target}：请 vi.doMock("db/connection.js") 换 :memory: 库，或 vi.stubEnv("DB_PATH", <临时路径>)。`,
      );
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    db = new Database(target);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    dbPath = target;
  }
  return db;
}

// 连接已建立后返回它实际打开的那个路径，避免与 getDb() 用的路径漂移。
export function getDbPath(): string {
  return dbPath ?? resolveDbPath();
}
