-- IK67H9 (T11)：交付新视频 SceneCard 应用闭环。
-- plan_application_receipts：一次成功应用 PlanMessage 的不可变事实（视频路径记 scene_card_id/版本/预设摘要，
--   图片路径 scene_card_id 为 NULL）。uk_plan_application_receipt_message 兜底「每条 PlanMessage 最多一次成功应用」
--   （CONTEXT L227）；uk_plan_application_command 兜底「同 CommandId 只返回首次结果」。
-- scene_card_generation_presets：SceneCard 持久拥有的视频生成预设，首次应用从冻结参数创建（1:1，uk_preset_scene）。
-- scene_card_generation_records：SceneCard 生成记录的用户可见聚合，summary_status 四态（CONTEXT L84-88）。
-- 三表均不可变 receipts 无 gmt_modified/version；preset/record 可变带 version/is_delete。

CREATE TABLE `plan_application_receipts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `message_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `application_kind` VARCHAR(32) NOT NULL,
    `scene_card_id` BIGINT NULL,
    `first_generation_job_id` BIGINT NOT NULL,
    `command_id` VARCHAR(128) NOT NULL,
    `content_digest` VARCHAR(80) NOT NULL,
    `result_version` INTEGER NULL,
    `preset_digest` VARCHAR(80) NULL,
    `target_scene_card_mention_id` BIGINT NULL,
    `applied_at` DATETIME(0) NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_plan_application_receipt_message`(`message_id`),
    UNIQUE INDEX `uk_plan_application_command`(`project_id`, `command_id`),
    INDEX `idx_plan_application_job`(`first_generation_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `scene_card_generation_presets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `scene_card_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `parameters` JSON NOT NULL,
    `reference_mode` VARCHAR(32) NOT NULL,
    `reference_assets` JSON NOT NULL,
    `capability_snapshot_version` JSON NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 1,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_preset_scene`(`scene_card_id`),
    INDEX `idx_preset_project`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `scene_card_generation_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `scene_card_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `summary_status` VARCHAR(16) NOT NULL,
    `plan_message_id` BIGINT NOT NULL,
    `application_receipt_id` BIGINT NOT NULL,
    `first_generation_job_id` BIGINT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 1,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_record_scene`(`scene_card_id`),
    INDEX `idx_record_project`(`project_id`),
    INDEX `idx_record_status`(`summary_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
