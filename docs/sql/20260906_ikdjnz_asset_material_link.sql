-- 工单：IKDJNZ 原始素材与真人/虚拟素材关联改造
-- 日期：2026-09-06
-- 变更：assets 表新增素材库关联字段（material_id / material_group_id）+ 唯一索引
-- 权威 DDL 见 packages/persistence/schema/ + prisma/migrations/
ALTER TABLE `assets` ADD COLUMN `material_id` VARCHAR(128) NULL COMMENT '素材库素材ID（asset-...）' AFTER `status`;
ALTER TABLE `assets` ADD COLUMN `material_group_id` VARCHAR(128) NULL COMMENT '素材库组ID（group-...）' AFTER `material_id`;
CREATE UNIQUE INDEX `uq_asset_material_id` ON `assets` (`material_id`);
CREATE INDEX `idx_asset_material_group` ON `assets` (`material_group_id`);
