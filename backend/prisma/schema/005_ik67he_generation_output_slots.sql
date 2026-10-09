SET NAMES utf8mb4;
CREATE TABLE `generation_output_slots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `generation_job_id` BIGINT NOT NULL,
    `scene_card_generation_record_id` BIGINT NULL,
    `slot_index` INTEGER NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `asset_id` BIGINT NULL,
    `retry_of_slot_id` BIGINT NULL,
    `initial_placement_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_slot_job`(`generation_job_id`),
    INDEX `idx_slot_record`(`scene_card_generation_record_id`),
    INDEX `idx_slot_placement`(`project_id`, `initial_placement_status`),
    UNIQUE INDEX `uk_slot_job_index`(`generation_job_id`, `slot_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
