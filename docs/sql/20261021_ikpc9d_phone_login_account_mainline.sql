SET NAMES utf8mb4;

ALTER TABLE `bw_users`
  ADD COLUMN `nickname` VARCHAR(50) NULL AFTER `username`;

ALTER TABLE `bw_verification_codes`
  ADD COLUMN `purpose` VARCHAR(20) NOT NULL DEFAULT 'login' AFTER `phone`,
  ADD COLUMN `attempts` INT NOT NULL DEFAULT 0 AFTER `is_used`,
  ADD INDEX `idx_phone_purpose_unused` (`phone`, `purpose`, `is_used`, `gmt_expire`);
