SET NAMES utf8mb4;

-- IKDLQJ: immutable conversation quote snapshots — text captured when a Canvas node is added to the conversation.
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
