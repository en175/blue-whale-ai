-- Node-owned fresh baseline. Generated from packages/persistence/prisma/schema.prisma.
-- No compatibility or data migration from the retired Java V1-V18 chain.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- CreateTable
CREATE TABLE `assets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL DEFAULT 0,
    `generation_job_id` BIGINT NULL,
    `type` VARCHAR(16) NOT NULL,
    `storage_key` VARCHAR(512) NULL,
    `content_sha256` VARCHAR(64) NULL,
    `url` VARCHAR(512) NOT NULL,
    `mime` VARCHAR(64) NULL,
    `size` BIGINT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `duration_ms` INTEGER NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'generated',
    `status` VARCHAR(32) NOT NULL DEFAULT 'normal',
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` BOOLEAN NOT NULL DEFAULT false,

    INDEX `idx_asset_project`(`project_id`),
    INDEX `idx_asset_project_type`(`project_id`, `type`),
    INDEX `idx_asset_generation_job`(`generation_job_id`),
    INDEX `idx_type`(`type`),
    INDEX `idx_user_id`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `canvas` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `viewport_json` JSON NULL,
    `nodes_json` JSON NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_canvas_project`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generation_jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NULL,
    `user_id` BIGINT NOT NULL,
    `agent_run_id` BIGINT NULL,
    `action_identity` VARCHAR(128) NULL,
    `project_action_identity` VARCHAR(128) NULL,
    `expected_output_count` INTEGER NOT NULL DEFAULT 1,
    `retry_of_job_id` BIGINT NULL,
    `type` VARCHAR(32) NOT NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'dock',
    `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `output_asset_ids` JSON NULL,
    `provider` VARCHAR(64) NULL,
    `provider_task_id` VARCHAR(128) NULL,
    `poll_count` INTEGER NOT NULL DEFAULT 0,
    `next_poll_at` DATETIME(0) NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `last_polled_at` DATETIME(0) NULL,
    `error` JSON NULL,
    `stage_id` VARCHAR(64) NULL,
    `lease_owner` VARCHAR(128) NULL,
    `lease_expires_at` DATETIME(0) NULL,
    `fencing_token` BIGINT NOT NULL DEFAULT 0,
    `strategy_version` VARCHAR(64) NULL,
    `execution_deadline_at` DATETIME(0) NULL,
    `evidence_reconcile_until` DATETIME(0) NULL,
    `next_action_at` DATETIME(0) NULL,
    `cancel_requested_at` DATETIME(0) NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` BOOLEAN NOT NULL DEFAULT false,
    `input` JSON NULL,

    INDEX `idx_project_id`(`project_id`),
    INDEX `idx_provider_task_id`(`provider_task_id`),
    INDEX `idx_status_next_poll`(`status`, `next_poll_at`),
    INDEX `idx_user_id`(`user_id`),
    INDEX `idx_generation_next_action`(`next_action_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generation_model_capability` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `provider_id` VARCHAR(32) NOT NULL,
    `model_id` VARCHAR(128) NOT NULL,
    `capability_type` VARCHAR(16) NOT NULL,
    `model_label` VARCHAR(64) NOT NULL,
    `icon` VARCHAR(512) NULL,
    `supported_sizes` JSON NOT NULL,
    `supported_aspect_ratios` JSON NOT NULL,
    `supported_durations` JSON NULL,
    `supported_formats` JSON NOT NULL,
    `default_size` VARCHAR(32) NOT NULL,
    `default_format` VARCHAR(16) NULL,
    `default_aspect_ratio` VARCHAR(16) NOT NULL,
    `default_duration` INTEGER NULL,
    `features` JSON NOT NULL,
    `channel_parser` VARCHAR(32) NOT NULL DEFAULT 'seedream',
    `request_mapping` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` BOOLEAN NOT NULL DEFAULT false,

    INDEX `idx_capability_type_enabled`(`capability_type`, `enabled`),
    UNIQUE INDEX `uk_provider_model`(`provider_id`, `model_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `owner_id` BIGINT NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `thumb` VARCHAR(512) NULL,
    `purpose` VARCHAR(32) NOT NULL DEFAULT 'canvas',
    `inbox_guard` BIGINT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_project_inbox_guard`(`inbox_guard`),
    INDEX `idx_project_owner`(`owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_conversation_project`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `agent_run_id` BIGINT NULL,
    `client_message_id` VARCHAR(64) NULL,
    `role` VARCHAR(16) NOT NULL,
    `content_type` VARCHAR(24) NOT NULL DEFAULT 'text',
    `content` TEXT NOT NULL,
    `sequence_no` INTEGER NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_message_project`(`project_id`),
    UNIQUE INDEX `uk_conversation_sequence`(`conversation_id`, `sequence_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_message_mentions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `message_id` BIGINT NOT NULL,
    `conversation_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `accepted_user_id` BIGINT NOT NULL,
    `mention_seq` INTEGER NOT NULL,
    `mention_type` VARCHAR(24) NOT NULL,
    `target_id` BIGINT NOT NULL,
    `target_version` INTEGER NULL,
    `display_name` VARCHAR(255) NOT NULL,
    `snapshot` JSON NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_message_mention_sequence`(`message_id`, `mention_seq`),
    INDEX `idx_mention_project_message`(`project_id`, `message_id`),
    INDEX `idx_mention_target`(`mention_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scene_cards` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `summary` TEXT NULL,
    `content_markdown` LONGTEXT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 1,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_scene_card_project`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `conversation_id` BIGINT NOT NULL,
    `active_guard` BIGINT NULL,
    `user_id` BIGINT NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `stage` VARCHAR(32) NULL,
    `engine` VARCHAR(64) NOT NULL,
    `engine_version` VARCHAR(64) NOT NULL,
    `adapter_schema_version` INTEGER NOT NULL,
    `current_checkpoint_id` BIGINT NULL,
    `confirmed_input_request_id` BIGINT NULL,
    `input_sequence_no` INTEGER NOT NULL DEFAULT 0,
    `lease_owner` VARCHAR(128) NULL,
    `lease_expires_at` DATETIME(0) NULL,
    `fencing_token` BIGINT NOT NULL DEFAULT 0,
    `terminal_reason` VARCHAR(64) NULL,
    `failure_code` VARCHAR(128) NULL,
    `failure_message` TEXT NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `skill_summarize` BOOLEAN NOT NULL DEFAULT false,
    `run_pin` JSON NULL,
    `activated_creative_skill_versions` JSON NULL,
    `reasoning_summary` VARCHAR(280) NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_agent_run_active_guard`(`active_guard`),
    INDEX `idx_agent_run_project_status`(`project_id`, `status`),
    INDEX `idx_agent_run_claim`(`status`, `engine`, `is_delete`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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
    `applied_at` DATETIME(0) NULL,
    `first_generation_job_id` BIGINT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_plan_message_message`(`message_id`),
    INDEX `idx_plan_message_project`(`project_id`),
    INDEX `idx_plan_message_agent_run`(`agent_run_id`),
    INDEX `idx_plan_message_application_kind`(`application_kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `command_idempotency` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `operation` VARCHAR(64) NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `request_hash` VARCHAR(64) NOT NULL,
    `message_id` BIGINT NULL,
    `agent_run_id` BIGINT NULL,
    `generation_job_id` BIGINT NULL,
    `resource_id` BIGINT NULL,
    `accepted_cursor` BIGINT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_command_idempotency`(`project_id`, `operation`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_event_stream` (
    `project_id` BIGINT NOT NULL,
    `high_watermark` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`project_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `cursor` BIGINT NOT NULL,
    `event_id` VARCHAR(64) NOT NULL,
    `event_type` VARCHAR(64) NOT NULL,
    `aggregate_type` VARCHAR(32) NOT NULL,
    `aggregate_id` VARCHAR(64) NOT NULL,
    `aggregate_version` INTEGER NOT NULL DEFAULT 0,
    `correlation_id` VARCHAR(64) NULL,
    `causation_id` VARCHAR(64) NULL,
    `occurred_at` DATETIME(0) NOT NULL,
    `payload` JSON NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_event_id`(`event_id`),
    INDEX `idx_project_occurred`(`project_id`, `occurred_at`),
    UNIQUE INDEX `uk_project_cursor`(`project_id`, `cursor`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `skill_code` VARCHAR(32) NULL,
    `description` TEXT NULL,
    `content` LONGTEXT NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'official',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `cover_url` VARCHAR(512) NULL,
    `category` VARCHAR(32) NOT NULL DEFAULT 'other',
    `search_keywords` TEXT NULL,
    `name_en` VARCHAR(255) NULL,
    `name_zh` VARCHAR(255) NULL,
    `description_en` TEXT NULL,
    `description_zh` TEXT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_name`(`name`),
    UNIQUE INDEX `uk_skill_code`(`skill_code`),
    INDEX `idx_sort`(`sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `template_card` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tag_code` VARCHAR(64) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `video_url` VARCHAR(512) NULL,
    `content` LONGTEXT NULL,
    `layout` VARCHAR(32) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_tag_id`(`tag_code`),
    INDEX `idx_tag_sort`(`tag_code`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `template_card_image` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `card_id` BIGINT NOT NULL,
    `image_url` VARCHAR(512) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_card_id`(`card_id`),
    INDEX `idx_card_sort`(`card_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable（IK764F：首页模板标签，原硬编码枚举落库；tag_code 与顺序固定，仅 label 可改名；IKA64P：visible 可见性开关）
CREATE TABLE `template_tag` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tag_code` VARCHAR(64) NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `visible` TINYINT NOT NULL DEFAULT 1,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_tag_code`(`tag_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SeedData（IK764F：与兜底枚举对齐；IKA64P：原五栏隐藏，新增视频/图片两栏）
INSERT INTO `template_tag` (`tag_code`, `label`, `sort_order`, `visible`) VALUES
    ('marketing', '营销视频', 0, 0),
    ('short', '微短片', 1, 0),
    ('replicate', '视频复刻', 2, 0),
    ('social', '社媒视频', 3, 0),
    ('image', '图片设计', 4, 0),
    ('video', '视频', 5, 1),
    ('picture', '图片', 6, 1);

-- CreateTable
CREATE TABLE `user_skill` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `skill_id` BIGINT NOT NULL,
    `auto` TINYINT NOT NULL DEFAULT 0,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_skill`(`skill_id`),
    INDEX `idx_user`(`user_id`),
    UNIQUE INDEX `uk_user_skill`(`user_id`, `skill_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(20) NOT NULL,
    `username` VARCHAR(50) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'NORMAL',
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 1,
    `is_delete` BOOLEAN NOT NULL DEFAULT false,
    `avatar` VARCHAR(255) NULL DEFAULT '0',
    `password` VARCHAR(63) NULL,

    UNIQUE INDEX `idx_phone`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verification_codes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `phone` VARCHAR(20) NOT NULL,
    `code` VARCHAR(6) NOT NULL,
    `ip` VARCHAR(50) NOT NULL,
    `gmt_expire` DATETIME(0) NOT NULL,
    `is_used` BOOLEAN NOT NULL DEFAULT false,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_ip_created`(`ip`, `gmt_create`),
    INDEX `idx_phone_created`(`phone`, `gmt_create`),
    INDEX `idx_phone_unused`(`phone`, `is_used`, `gmt_expire`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cost_reservations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `generation_job_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `action_identity` VARCHAR(128) NOT NULL,
    `action_type` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `reserved_amount_fen` BIGINT NOT NULL,
    `actual_amount_fen` BIGINT NULL,
    `status` VARCHAR(32) NOT NULL,
    `price_catalog_version` VARCHAR(64) NOT NULL,
    `exchange_rate_version` VARCHAR(64) NOT NULL,
    `model_policy_version` VARCHAR(64) NOT NULL,
    `cost_rule_version` VARCHAR(64) NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_cost_reservation_job`(`generation_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generation_job_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `generation_job_id` BIGINT NOT NULL,
    `event` VARCHAR(64) NOT NULL,
    `status` VARCHAR(32) NULL,
    `payload` JSON NULL,
    `message` TEXT NULL,
    `occurred_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_gen_job_log_job_time`(`generation_job_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creative_skill` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `creative_skill_id` VARCHAR(80) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `source_skill_id` BIGINT NULL,
    `active_version_id` VARCHAR(80) NULL,
    `owner_user_id` BIGINT NOT NULL DEFAULT 0,
    `asset_domain` VARCHAR(16) NOT NULL DEFAULT 'official',
    `name_key` VARCHAR(255) NULL,
    `auto_match` TINYINT NOT NULL DEFAULT 0,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_creative_skill_id`(`creative_skill_id`),
    INDEX `idx_owner_domain`(`owner_user_id`, `asset_domain`),
    INDEX `idx_owner_name_key`(`owner_user_id`, `name_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creative_skill_version` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `creative_skill_version_id` VARCHAR(80) NOT NULL,
    `creative_skill_id` VARCHAR(80) NOT NULL,
    `display_version` VARCHAR(64) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `content_digest` VARCHAR(71) NOT NULL,
    `resource_digest` VARCHAR(71) NOT NULL,
    `media_type` VARCHAR(128) NOT NULL DEFAULT 'text/markdown',
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_creative_skill_version_id`(`creative_skill_version_id`),
    UNIQUE INDEX `uk_creative_skill_version_semver`(`creative_skill_id`, `display_version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `creative_skill_activation` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `creative_skill_id` VARCHAR(80) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `agent_run_id` VARCHAR(64) NOT NULL,
    `skill_version` INTEGER NOT NULL DEFAULT 1,
    `activation_source` VARCHAR(16) NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_skill_user`(`creative_skill_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `skill_summarize_session` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `draft_content` TEXT NOT NULL,
    `proposed_name` VARCHAR(255) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending_name_confirm',
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_skill_summarize_session_conversation`(`conversation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_operation_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `category` VARCHAR(32) NOT NULL DEFAULT '',
    `action` VARCHAR(64) NOT NULL,
    `target` VARCHAR(255) NOT NULL DEFAULT '',
    `target_user_id` BIGINT NULL,
    `detail` TEXT NOT NULL,
    `operator` VARCHAR(64) NOT NULL DEFAULT '',
    `operator_id` BIGINT NULL,
    `ip_address` VARCHAR(64) NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_oplog_category_created`(`category`, `gmt_create`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `topup_tiers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL DEFAULT '',
    `amount` BIGINT NOT NULL,
    `original_price` DECIMAL(10, 2) NOT NULL,
    `discount` DECIMAL(5, 4) NOT NULL DEFAULT 1,
    `price` DECIMAL(10, 2) NOT NULL,
    `is_recommended` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `start_time` DATETIME(0) NULL,
    `end_time` DATETIME(0) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- IK67H9 (T11)：PlanMessage 应用闭环三表。双写自 migration 20260805130000。
CREATE TABLE `plan_application_receipts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `message_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `conversation_id` BIGINT NULL,
    `agent_run_id` BIGINT NULL,
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

-- IKCH05：首页背景图/视频后台动态配置条目。
-- 与 prisma/migrations/20260901142500_ikch05_homepage_hero/migration.sql 双轨同步。
CREATE TABLE `homepage_hero` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `media_type` VARCHAR(16) NOT NULL DEFAULT 'video',
    `media_url` VARCHAR(512) NOT NULL,
    `poster_url` VARCHAR(512) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `enabled` TINYINT NOT NULL DEFAULT 1,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_hero_enabled_sort`(`enabled`, `is_delete`, `sort_order`),
    INDEX `idx_hero_sort`(`sort_order`, `is_delete`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
