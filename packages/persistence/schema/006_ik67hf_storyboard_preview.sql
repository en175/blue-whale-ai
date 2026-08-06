-- IK67HF (T15)：可选 StoryboardPreview（分镜预览）流程（CONTEXT L43-47）。
-- 分镜预览会话聚合根 + SceneCard 绑定 + 幂等键；画格复用 generation_output_slots + assets。
CREATE TABLE `storyboard_previews` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `scene_card_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `first_generation_job_id` BIGINT NOT NULL,
    `command_id` VARCHAR(128) NOT NULL,
    `summary_status` VARCHAR(16) NOT NULL,
    `capability_snapshot_version` JSON NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 1,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_storyboard_command`(`project_id`, `command_id`),
    INDEX `idx_storyboard_scene`(`scene_card_id`),
    INDEX `idx_storyboard_project`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
