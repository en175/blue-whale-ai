-- IKDJNZ：assets 表新增素材库关联字段。
-- 素材库（真人/虚拟人像库）本地零落表，仅存上游素材/组 ID 字符串。
-- 历史数据不处理（两列默认 NULL）。
ALTER TABLE `assets` ADD COLUMN `material_id` VARCHAR(128) NULL COMMENT '素材库素材ID（asset-...）' AFTER `status`;
ALTER TABLE `assets` ADD COLUMN `material_group_id` VARCHAR(128) NULL COMMENT '素材库组ID（group-...）' AFTER `material_id`;

-- material_id 唯一索引兜底「一张素材只能关联一张素材库素材」。
CREATE UNIQUE INDEX `uq_asset_material_id` ON `assets` (`material_id`);
-- 素材库组删除旁路按组 ID 批量清关联。
CREATE INDEX `idx_asset_material_group` ON `assets` (`material_group_id`);
