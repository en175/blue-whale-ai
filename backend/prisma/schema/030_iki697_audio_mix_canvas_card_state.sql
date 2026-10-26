SET NAMES utf8mb4;

ALTER TABLE `generation_jobs`
  ADD COLUMN `canvas_card_state` VARCHAR(16) NOT NULL DEFAULT 'pending';
