--   SELECT COUNT(*) FROM assets WHERE duration_ms IS NULL AND duration IS NOT NULL;     -- 回填候选（迁移会回填）
SET NAMES utf8mb4;

UPDATE `assets` SET `duration_ms` = `duration` * 1000
  WHERE `duration_ms` IS NULL AND `duration` IS NOT NULL;
ALTER TABLE `assets` DROP COLUMN `duration`;

ALTER TABLE `topup_tiers`
  MODIFY COLUMN `original_price` DECIMAL(10, 2) NOT NULL,
  MODIFY COLUMN `discount` DECIMAL(5, 4) NOT NULL DEFAULT 1,
  MODIFY COLUMN `price` DECIMAL(10, 2) NOT NULL;
