SET NAMES utf8mb4;

-- IKDLQE: retain canonical preview content after deletion or Agent revision changes.
CREATE TABLE `prompt_preview_snapshots` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT NOT NULL,
  `source_key` VARCHAR(64) NOT NULL,
  `source_json` JSON NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `text` MEDIUMTEXT NOT NULL,
  `gmt_create` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prompt_preview_source` (`project_id`, `source_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
