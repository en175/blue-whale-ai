-- IK67H8 (T10)：PlanMessage 手动应用闭环（图片分支）。
-- plan_messages 记录首次成功应用时间 + 首个图片任务，支持 at-most-once 与刷新恢复；
-- plan_application_receipts 存应用回执，uk(plan_message_id) 兜底并发第二写。
-- idempotency_key 指向首次触发的 command_idempotency 行（operation=plan_message.apply）。
ALTER TABLE `plan_messages` ADD COLUMN `applied_at` DATETIME(0) NULL;
ALTER TABLE `plan_messages` ADD COLUMN `first_generation_job_id` BIGINT NULL;

CREATE TABLE `plan_application_receipts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `plan_message_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `conversation_id` BIGINT NOT NULL,
    `agent_run_id` BIGINT NOT NULL,
    `application_kind` VARCHAR(32) NOT NULL,
    `first_generation_job_id` BIGINT NOT NULL,
    `content_digest` VARCHAR(80) NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `scene_card_id` BIGINT NULL,
    `result_scene_card_version` INTEGER NULL,
    `generation_preset_digest` VARCHAR(80) NULL,
    `applied_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_plan_application_receipt`(`plan_message_id`),
    INDEX `idx_plan_application_project`(`project_id`),
    INDEX `idx_plan_application_job`(`first_generation_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
