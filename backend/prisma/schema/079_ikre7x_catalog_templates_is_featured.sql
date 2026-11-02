SET NAMES utf8mb4;

ALTER TABLE `catalog_templates`
  ADD COLUMN `is_featured` TINYINT NOT NULL DEFAULT 0 AFTER `sort_order`;
