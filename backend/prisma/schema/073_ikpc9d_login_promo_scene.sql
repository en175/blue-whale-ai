SET NAMES utf8mb4;

ALTER TABLE `homepage_hero`
  ADD COLUMN `scene` VARCHAR(20) NOT NULL DEFAULT 'homepage' AFTER `poster_url`,
  ADD INDEX `idx_hero_scene_enabled_sort` (`scene`, `enabled`, `is_delete`, `sort_order`);
