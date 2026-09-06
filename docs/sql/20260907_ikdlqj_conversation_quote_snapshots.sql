SET NAMES utf8mb4;

-- 工单：IKDLQJ　日期：2026-09-07　变更：新增对话引用快照表
-- 用户把画布节点正文「添加到对话」时冻结的当时正文与来源；只增不改，来源节点删除后仍可回读。
CREATE TABLE `conversation_quote_snapshots` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `quote_key` VARCHAR(64) NOT NULL,
  `node_id` VARCHAR(128) NOT NULL,
  `source_json` JSON NULL,
  `title` VARCHAR(200) NOT NULL,
  `text` MEDIUMTEXT NOT NULL,
  `gmt_create` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_conversation_quote` (`project_id`, `quote_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
