SET NAMES utf8mb4;

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

DROP TABLE IF EXISTS `api_key_usage`;
DROP TABLE IF EXISTS `api_key`;
DROP TABLE IF EXISTS `captcha_challenges`;

UPDATE `users` SET `status` = 0 WHERE `status` IS NULL;
ALTER TABLE `users` MODIFY COLUMN `status` VARCHAR(30) NOT NULL DEFAULT 'NORMAL';
UPDATE `users` SET `status` = 'NORMAL' WHERE `status` IN ('0', '1');

ALTER TABLE `users` MODIFY COLUMN `username` VARCHAR(50) NOT NULL;

ALTER TABLE `users` MODIFY COLUMN `password` VARCHAR(63) NULL;

UPDATE `template_card` SET `is_delete` = 1 WHERE `deleted` = 1 AND `is_delete` = 0;
UPDATE `template_card_image` SET `is_delete` = 1 WHERE `deleted` = 1 AND `is_delete` = 0;
UPDATE `template_card` SET `version` = 0 WHERE `version` IS NULL;
UPDATE `template_card_image` SET `version` = 0 WHERE `version` IS NULL;

ALTER TABLE `template_card`
  DROP COLUMN `deleted`,
  DROP COLUMN `create_time`,
  DROP COLUMN `update_time`,
  MODIFY COLUMN `version` INTEGER NOT NULL DEFAULT 0,
  MODIFY COLUMN `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  MODIFY COLUMN `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0);

ALTER TABLE `template_card_image`
  DROP COLUMN `deleted`,
  DROP COLUMN `create_time`,
  DROP COLUMN `update_time`,
  MODIFY COLUMN `version` INTEGER NOT NULL DEFAULT 0,
  MODIFY COLUMN `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  MODIFY COLUMN `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0);

ALTER TABLE `template_tag`
  CHANGE COLUMN `create_time` `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  CHANGE COLUMN `update_time` `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0);
