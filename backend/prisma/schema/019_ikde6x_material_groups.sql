-- 019_ikde6x_material_groups：schema 基线片段。
SET NAMES utf8mb4;

-- IKDE6X：素材库组落地。虚拟人像库组 + 真人像库组，本地为组主、上游备份、双向维护。
-- kind：virtual=虚拟人像库组（每用户至多 1 个默认组），real=真人像库组（每用户可多个）。
-- cover_url：封面图（真人组用，虚拟组可空）。material_group_id：上游组 id（group-...）。
-- is_default 每用户 virtual 至多 1 个由应用层保证（不设 DB 条件唯一索引）。
-- 与 prisma/migrations/20260908090000_ikde6x_material_groups/migration.sql 双轨同步。
CREATE TABLE `material_groups` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `material_group_id` VARCHAR(128) NOT NULL COMMENT '上游组ID（group-...）',
  `kind` VARCHAR(16) NOT NULL COMMENT 'virtual | real',
  `name` VARCHAR(128) NOT NULL COMMENT '组名',
  `cover_url` VARCHAR(512) NULL COMMENT '封面图（真人组用，virtual 可空）',
  `is_default` BOOLEAN NOT NULL DEFAULT false COMMENT '每用户虚拟默认组标记',
  `status` VARCHAR(32) NOT NULL DEFAULT 'normal',
  `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `version` INT NOT NULL DEFAULT 0,
  `is_delete` BOOLEAN NOT NULL DEFAULT false,
  `deleted_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_material_group_user_upstream` (`user_id`, `material_group_id`),
  KEY `idx_material_group_user_kind` (`user_id`, `kind`),
  KEY `idx_material_group_user_alive` (`user_id`, `is_delete`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
