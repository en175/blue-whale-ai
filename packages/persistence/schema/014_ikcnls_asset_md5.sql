-- IKCNLS：assets 表新增 md5 字段（按人去重省 TOS），存量历史资产 md5=NULL 不参与去重。
-- 与 prisma/migrations/20260902120000_ikcnls_asset_md5/migration.sql 双轨同步。
ALTER TABLE `assets` ADD COLUMN `md5` VARCHAR(32) NULL COMMENT '文件MD5（按人去重）' AFTER `content_sha256`;

-- 去重查询索引：按 (user_id, md5, is_delete) 查未删资产。
CREATE INDEX `idx_asset_user_md5` ON `assets` (`user_id`, `md5`, `is_delete`);
