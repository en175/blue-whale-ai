-- 测试库结构优化：清理死表、Go 残留列、模板冗余列、users 漂移修复。
-- 前置校验（执行前人工确认）：
--   SELECT COUNT(*) FROM users WHERE username IS NULL;  -- 须为 0
--   SELECT COUNT(*) FROM users WHERE phone IS NULL;     -- 须为 0

-- ============================================================
-- A 层：users 表 25 个 Go 残留列（GORM AutoMigrate 孤儿列，Node 代码零读写）
-- ============================================================
ALTER TABLE `users`
  DROP COLUMN `display_name`,
  DROP COLUMN `role`,
  DROP COLUMN `email`,
  DROP COLUMN `github_id`,
  DROP COLUMN `discord_id`,
  DROP COLUMN `oidc_id`,
  DROP COLUMN `wechat_id`,
  DROP COLUMN `telegram_id`,
  DROP COLUMN `access_token`,
  DROP COLUMN `quota`,
  DROP COLUMN `used_quota`,
  DROP COLUMN `request_count`,
  DROP COLUMN `group`,
  DROP COLUMN `aff_code`,
  DROP COLUMN `aff_count`,
  DROP COLUMN `aff_quota`,
  DROP COLUMN `aff_history`,
  DROP COLUMN `inviter_id`,
  DROP COLUMN `deleted_at`,
  DROP COLUMN `linux_do_id`,
  DROP COLUMN `setting`,
  DROP COLUMN `remark`,
  DROP COLUMN `stripe_customer`,
  DROP COLUMN `created_at`,
  DROP COLUMN `last_login_at`;

-- ============================================================
-- B 层：删除死表（全仓库零业务读写）
-- ============================================================
DROP TABLE IF EXISTS `api_key_usage`;
DROP TABLE IF EXISTS `api_key`;
DROP TABLE IF EXISTS `captcha_challenges`;

-- ============================================================
-- C 层：users 漂移修复（schema.prisma 已正确，DB  drifted）
-- ============================================================
-- C1: status bigint → varchar(30)。存量全为 0，代码只写 'NORMAL'
-- 顺序：先归一 NULL(若有)→ 再改类型 → 最后仅归一名义值(不覆盖未知状态值)
UPDATE `users` SET `status` = 0 WHERE `status` IS NULL;
ALTER TABLE `users` MODIFY COLUMN `status` VARCHAR(30) NOT NULL DEFAULT 'NORMAL';
UPDATE `users` SET `status` = 'NORMAL' WHERE `status` IN ('0', '1');

-- C2: username varchar(191) → varchar(50)（实测最长 8，安全）
ALTER TABLE `users` MODIFY COLUMN `username` VARCHAR(50) NOT NULL;

-- C3: password longtext → varchar(63)（实测最长 60，安全）
ALTER TABLE `users` MODIFY COLUMN `password` VARCHAR(63) NULL;

-- ============================================================
-- D 层：template 冗余列清理
-- ============================================================
-- D1: 数据归一（deleted 有 14 行只被旧列标记；version 全 NULL）
UPDATE `template_card` SET `is_delete` = 1 WHERE `deleted` = 1 AND `is_delete` = 0;
UPDATE `template_card_image` SET `is_delete` = 1 WHERE `deleted` = 1 AND `is_delete` = 0;
UPDATE `template_card` SET `version` = 0 WHERE `version` IS NULL;
UPDATE `template_card_image` SET `version` = 0 WHERE `version` IS NULL;

-- D2: template_card 删冗余列 + 类型修正
ALTER TABLE `template_card`
  DROP COLUMN `deleted`,
  DROP COLUMN `create_time`,
  DROP COLUMN `update_time`,
  MODIFY COLUMN `version` INTEGER NOT NULL DEFAULT 0,
  MODIFY COLUMN `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  MODIFY COLUMN `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0);

-- D3: template_card_image 同上
ALTER TABLE `template_card_image`
  DROP COLUMN `deleted`,
  DROP COLUMN `create_time`,
  DROP COLUMN `update_time`,
  MODIFY COLUMN `version` INTEGER NOT NULL DEFAULT 0,
  MODIFY COLUMN `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  MODIFY COLUMN `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0);

-- D4: template_tag 时间列重命名（对齐全库 gmt_* 约定）
ALTER TABLE `template_tag`
  CHANGE COLUMN `create_time` `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  CHANGE COLUMN `update_time` `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0);
