SET NAMES utf8mb4;

ALTER TABLE `project`
  ADD COLUMN `last_edited_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `last_opened_at`;

UPDATE `project` SET `last_edited_at` = `gmt_create`;
