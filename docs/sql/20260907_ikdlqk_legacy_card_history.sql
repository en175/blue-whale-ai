-- 工单：IKDLQK（旧生成卡迁移为文本节点并保留历史）
-- 日期：2026-09-07
-- 变更简述：新增 legacy_card_history 不可变历史表——旧生成卡转换为普通文本节点前，先落标题、实际提示词、画面描述、预览来源与完整原卡片 JSON；(project_id, node_id) 唯一保证幂等。
-- 权威迁移：packages/persistence/prisma/migrations/20260907120000_ikdlqk_legacy_card_history/migration.sql

CREATE TABLE `legacy_card_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `node_id` VARCHAR(128) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `prompt_text` MEDIUMTEXT NOT NULL,
  `visual_text` MEDIUMTEXT NULL,
  `source_json` JSON NULL,
  `card_json` JSON NOT NULL,
  `gmt_create` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_legacy_card_history` (`project_id`, `node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
