SET NAMES utf8mb4;

ALTER TABLE `project`
  ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'canvas' AFTER `purpose`;
