SET NAMES utf8mb4;

ALTER TABLE `assets` ADD COLUMN `md5` VARCHAR(32) NULL COMMENT '文件MD5（按人去重）' AFTER `content_sha256`;

CREATE INDEX `idx_asset_user_md5` ON `assets` (`user_id`, `md5`, `is_delete`);
