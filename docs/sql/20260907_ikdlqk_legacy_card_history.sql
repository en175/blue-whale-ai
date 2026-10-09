
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
