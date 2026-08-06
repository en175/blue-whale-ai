-- IK67H6 (T09)：PlanMessage 原子提交。
-- conversation_messages 新增 content_type 区分普通文本(text)与计划卡(plan_message)子类型；
-- run_commits.outcome 加宽以容纳 completed_with_plan（保持 completed = 一条助手消息不变量）；
-- plan_messages 存计划卡冻结态，与 conversation_messages(content_type=plan_message) 1:1。
-- 历史消息无 content_type 语义 → 默认 'text' 兼容。
ALTER TABLE `conversation_messages` ADD COLUMN `content_type` VARCHAR(24) NOT NULL DEFAULT 'text';
ALTER TABLE `run_commits` MODIFY COLUMN `outcome` VARCHAR(32) NOT NULL;

CREATE TABLE `plan_messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `message_id` BIGINT NOT NULL,
    `conversation_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `agent_run_id` BIGINT NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `total_in_batch` INTEGER NOT NULL,
    `sequence_label` VARCHAR(255) NULL,
    `application_kind` VARCHAR(32) NOT NULL,
    `target_scene_card_mention_id` BIGINT NULL,
    `base_scene_card_version` INTEGER NULL,
    `content_markdown` LONGTEXT NOT NULL,
    `derived_references` JSON NOT NULL,
    `frozen_generation_parameters` JSON NOT NULL,
    `capability_snapshot_version` JSON NOT NULL,
    `provider_prompt_projection` JSON NOT NULL,
    `base_plan_message_id` BIGINT NULL,
    `source_plan_message_id` BIGINT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_plan_message_message`(`message_id`),
    INDEX `idx_plan_message_project`(`project_id`),
    INDEX `idx_plan_message_agent_run`(`agent_run_id`),
    INDEX `idx_plan_message_application_kind`(`application_kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
