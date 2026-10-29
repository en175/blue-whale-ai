SET NAMES utf8mb4;

ALTER TABLE `project`
  ADD COLUMN `entry_kind` VARCHAR(16) NOT NULL DEFAULT 'canvas' AFTER `purpose`;
