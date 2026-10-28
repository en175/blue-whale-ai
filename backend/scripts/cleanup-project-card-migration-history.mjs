#!/usr/bin/env node

import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const RETENTION_DAYS = Number(daysArg?.slice("--days=".length) ?? process.env.RETENTION_DAYS ?? 180);
const BATCH_SIZE = 5000;

if (!Number.isInteger(RETENTION_DAYS) || RETENTION_DAYS <= 0) {
  console.error("✗ 保留天数无效：--days=<正整数> 或 RETENTION_DAYS");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("✗ 缺少 DATABASE_URL。用法：DATABASE_URL=mysql://... node backend/scripts/cleanup-project-card-migration-history.mjs [--days=180] [--apply]");
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""),
  supportBigNumbers: true,
  bigNumberStrings: true,
});

await connection.query("SET time_zone = ?", [url.searchParams.get("timezone") ?? "+08:00"]);

const mode = APPLY ? "APPLY（写库）" : "DRY-RUN（只读）";
console.log(`\n=== project_card_migration_history 保留期清理 — ${mode}，保留 ${RETENTION_DAYS} 天 ===\n`);

const [[countRow]] = await connection.query(
  "SELECT COUNT(*) AS total FROM project_card_migration_history WHERE gmt_create < NOW() - INTERVAL ? DAY",
  [RETENTION_DAYS],
);
console.log(`超期行：${countRow.total}`);

let deleted = 0;
if (APPLY) {
  for (;;) {
    const [result] = await connection.query(
      "DELETE FROM project_card_migration_history WHERE gmt_create < NOW() - INTERVAL ? DAY ORDER BY id LIMIT ?",
      [RETENTION_DAYS, BATCH_SIZE],
    );
    deleted += result.affectedRows;
    if (result.affectedRows < BATCH_SIZE) break;
  }
  console.log(`已删除：${deleted}`);
} else {
  console.log("未写库；确认后加 --apply 执行。");
}

await connection.end();
