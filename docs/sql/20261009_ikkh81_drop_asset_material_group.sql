SET NAMES utf8mb4;

DROP INDEX `idx_asset_material_group` ON `assets`;

ALTER TABLE `assets` DROP COLUMN `material_group_id`;
