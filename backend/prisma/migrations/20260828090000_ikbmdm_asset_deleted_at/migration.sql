-- IKBMDM：assets 新增软删时间列，供延迟 GC 物理回收判断超期。
ALTER TABLE `assets` ADD COLUMN `deleted_at` DATETIME(0) NULL;

-- 既存软删行回填：GC 只认 deleted_at，历史已删行须补盖（时间取 gmt_modified，其含义最接近删除时刻）。
UPDATE `assets` SET `deleted_at` = `gmt_modified` WHERE `is_delete` = 1 AND `deleted_at` IS NULL;

-- GC 候选扫描索引：listGcCandidates 按 is_delete + deleted_at 过滤。
CREATE INDEX `idx_asset_gc_candidates` ON `assets` (`is_delete`, `deleted_at`);

-- findLiveRefs 引用核对索引：按 storage_key IN + is_delete=false 过滤（G4）。
CREATE INDEX `idx_asset_storage_live` ON `assets` (`storage_key`, `is_delete`);
