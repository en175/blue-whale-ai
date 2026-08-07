-- IK67HE (T14)：输出槽重试与 Canvas 放置恢复（spec §4.4 / ADR-0026）。
-- 每次生成在提交时固定数量的输出槽，身份与顺序稳定（slot_index）。
-- 成功 Asset 永久占据原槽；重试只补 failed/missing 槽，不覆盖成功输出。
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
