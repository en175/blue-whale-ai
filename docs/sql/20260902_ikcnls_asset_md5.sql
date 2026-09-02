-- IKCNLS：assets 表新增 md5 字段（按人去重省 TOS）。
-- 历史快照（docs/sql）：面向可读性的库变更记录，权威 DDL 见 packages/persistence/schema/ + prisma/migrations/。
-- 日期：2026-09-02
ALTER TABLE `assets` ADD COLUMN `md5` VARCHAR(32) NULL COMMENT '文件MD5（按人去重）' AFTER `content_sha256`;

CREATE INDEX `idx_asset_user_md5` ON `assets` (`user_id`, `md5`, `is_delete`);
