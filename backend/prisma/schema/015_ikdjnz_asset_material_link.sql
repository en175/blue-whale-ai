SET NAMES utf8mb4;

ALTER TABLE `assets` ADD COLUMN `material_id` VARCHAR(128) NULL COMMENT '素材库素材ID（asset-...）' AFTER `status`;
ALTER TABLE `assets` ADD COLUMN `material_group_id` VARCHAR(128) NULL COMMENT '素材库组ID（group-...）' AFTER `material_id`;

CREATE UNIQUE INDEX `uq_asset_material_id` ON `assets` (`material_id`);
CREATE INDEX `idx_asset_material_group` ON `assets` (`material_group_id`);
