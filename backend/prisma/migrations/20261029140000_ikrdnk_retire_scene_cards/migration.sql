SET NAMES utf8mb4;

DROP TABLE IF EXISTS `scene_card_generation_records`;
DROP TABLE IF EXISTS `scene_card_generation_presets`;
DROP TABLE IF EXISTS `storyboard_previews`;
DROP TABLE IF EXISTS `scene_cards`;

ALTER TABLE `generation_output_slots`
    DROP INDEX `idx_slot_record`,
    DROP COLUMN `scene_card_generation_record_id`;
