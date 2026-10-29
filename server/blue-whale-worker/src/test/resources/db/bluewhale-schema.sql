CREATE TABLE `user_assets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL DEFAULT 0,
    `generation_job_id` BIGINT NULL,
    `type` VARCHAR(16) NOT NULL,
    `name` VARCHAR(255) NULL,
    `storage_key` VARCHAR(512) NULL,
    `content_sha256` VARCHAR(64) NULL,
    `md5` VARCHAR(32) NULL,
    `url` VARCHAR(512) NOT NULL,
    `mime` VARCHAR(64) NULL,
    `size` BIGINT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `duration_ms` INTEGER NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'generated',
    `status` VARCHAR(32) NOT NULL DEFAULT 'normal',
    `material_id` VARCHAR(128) NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` BOOLEAN NOT NULL DEFAULT false,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_asset_project`(`project_id`),
    INDEX `idx_asset_project_type`(`project_id`, `type`),
    INDEX `idx_asset_generation_job`(`generation_job_id`),
    INDEX `idx_type`(`type`),
    INDEX `idx_user_id`(`user_id`),
    INDEX `idx_asset_storage_live`(`storage_key`, `is_delete`),
    INDEX `idx_asset_gc_candidates`(`is_delete`, `deleted_at`),
    INDEX `idx_asset_user_md5`(`user_id`, `md5`, `is_delete`),
    UNIQUE INDEX `uq_asset_material_id`(`material_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_material_groups` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `material_group_id` VARCHAR(128) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `cover_url` VARCHAR(512) NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(32) NOT NULL DEFAULT 'normal',
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` BOOLEAN NOT NULL DEFAULT false,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_material_group_user_kind`(`user_id`, `kind`),
    INDEX `idx_material_group_user_alive`(`user_id`, `is_delete`),
    UNIQUE INDEX `uk_material_group_user_upstream`(`user_id`, `material_group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_canvas` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `viewport_json` JSON NULL,
    `nodes_json` JSON NULL,
    `edges_json` JSON NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,
    `rows_authoritative` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_project_canvas__project`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generation_jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NULL,
    `user_id` BIGINT NOT NULL,
    `retry_of_job_id` BIGINT NULL,
    `type` VARCHAR(32) NOT NULL,
    `source` VARCHAR(32) NOT NULL DEFAULT 'dock',
    `status` VARCHAR(32) NOT NULL DEFAULT 'queued',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `output_asset_ids` JSON NULL,
    `provider` VARCHAR(64) NULL,
    `provider_task_id` VARCHAR(128) NULL,
    `poll_count` INTEGER NOT NULL DEFAULT 0,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `last_polled_at` DATETIME(0) NULL,
    `error` JSON NULL,
    `lease_owner` VARCHAR(128) NULL,
    `lease_expires_at` DATETIME(0) NULL,
    `fencing_token` BIGINT NOT NULL DEFAULT 0,
    `execution_deadline_at` DATETIME(0) NULL,
    `next_action_at` DATETIME(0) NULL,
    `cancel_requested_at` DATETIME(0) NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` BOOLEAN NOT NULL DEFAULT false,
    `input` JSON NULL,
    `source_sample_job_id` BIGINT NULL,
    UNIQUE INDEX `uk_generation_jobs__source_sample_job_id`(`source_sample_job_id`),

    INDEX `idx_project_id`(`project_id`),
    INDEX `idx_provider_task_id`(`provider_task_id`),
    INDEX `idx_user_id`(`user_id`),
    INDEX `idx_generation_next_action`(`next_action_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generation_job_extras` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `generation_job_id` BIGINT NOT NULL,
    `extra_key` VARCHAR(64) NOT NULL,
    `value_type` VARCHAR(16) NOT NULL,
    `value_text` TEXT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_job_extras__job_key`(`generation_job_id`, `extra_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `catalog_models` (
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

CREATE TABLE `project_asset` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `asset_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_pa_user_project`(`user_id`, `project_id`),
    INDEX `idx_pa_asset`(`asset_id`),
    INDEX `idx_pa_project`(`project_id`),
    UNIQUE INDEX `uk_project_asset`(`user_id`, `asset_id`, `project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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


CREATE TABLE `project_command_receipts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `operation` VARCHAR(64) NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `request_hash` VARCHAR(64) NOT NULL,
    `message_id` BIGINT NULL,
    `agent_run_id` BIGINT NULL,
    `generation_job_id` BIGINT NULL,
    `resource_id` BIGINT NULL,
    `result_payload` JSON NULL,
    `accepted_cursor` BIGINT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_project_command_receipts__key`(`project_id`, `operation`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `catalog_skills` (
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

CREATE TABLE `catalog_templates` (
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

CREATE TABLE `catalog_template_images` (
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

CREATE TABLE `catalog_template_tags` (
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

CREATE TABLE `user_skills` (
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
    UNIQUE INDEX `uk_user_skills__user_skill`(`user_id`, `skill_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `content_homepage_heroes` (
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

CREATE TABLE `catalog_creative_skills` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `creative_skill_id` VARCHAR(80) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `source_skill_id` BIGINT NULL,
    `active_version_id` VARCHAR(80) NULL,
    `owner_user_id` BIGINT NOT NULL DEFAULT 0,
    `asset_domain` VARCHAR(16) NOT NULL DEFAULT 'official',
    `name_key` VARCHAR(255) NULL,
    `auto_match` INTEGER NOT NULL DEFAULT 0,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_catalog_creative_skills__creative_skill_id`(`creative_skill_id`),
    INDEX `idx_owner_domain`(`owner_user_id`, `asset_domain`),
    INDEX `idx_owner_name_key`(`owner_user_id`, `name_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `catalog_creative_skill_versions` (
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

    UNIQUE INDEX `uk_catalog_creative_skill_versions__creative_skill_version_id`(`creative_skill_version_id`),
    UNIQUE INDEX `uk_catalog_creative_skill_versions__semver`(`creative_skill_id`, `display_version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE TABLE `billing_products` (
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

    INDEX `idx_tier_status_sort`(`status`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bw_operation_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `category` VARCHAR(32) NOT NULL DEFAULT '',
    `action` VARCHAR(64) NOT NULL,
    `target` VARCHAR(255) NOT NULL DEFAULT '',
    `target_user_id` BIGINT NULL,
    `detail` TEXT NOT NULL,
    `operator` VARCHAR(64) NOT NULL DEFAULT '',
    `operator_id` BIGINT NULL,
    `ip_address` VARCHAR(64) NULL,
    `status` TINYINT NOT NULL DEFAULT 0,
    `ref` VARCHAR(64) NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_oplog_category_created`(`category`, `gmt_create`),
    INDEX `idx_bw_operation_logs__ref`(`ref`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `billing_cost_reservations` (
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
    `release_note` VARCHAR(255) NULL,
    `price_catalog_version` VARCHAR(64) NOT NULL,
    `exchange_rate_version` VARCHAR(64) NOT NULL,
    `model_policy_version` VARCHAR(64) NOT NULL,
    `cost_rule_version` VARCHAR(64) NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_billing_cost_reservations__job`(`generation_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `billing_cost_adjustments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `batch_no` VARCHAR(64) NOT NULL,
    `generation_job_id` BIGINT NULL,
    `user_id` BIGINT NOT NULL,
    `project_id` BIGINT NULL,
    `action_type` VARCHAR(32) NOT NULL,
    `amount_fen` BIGINT NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `new_api_snapshot` TEXT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_adj_batch`(`batch_no`),
    UNIQUE INDEX `uk_adj_job_action`(`generation_job_id`, `action_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE TABLE `generation_output_slots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `generation_job_id` BIGINT NOT NULL,
    `slot_index` INTEGER NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `asset_id` BIGINT NULL,
    `retry_of_slot_id` BIGINT NULL,
    `initial_placement_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_slot_job`(`generation_job_id`),
    INDEX `idx_slot_placement`(`project_id`, `initial_placement_status`),
    UNIQUE INDEX `uk_slot_job_index`(`generation_job_id`, `slot_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_prompt_preview_snapshots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `source_key` VARCHAR(64) NOT NULL,
    `source_json` JSON NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `text` MEDIUMTEXT NOT NULL,
    `content_json` JSON NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_project_prompt_preview_snapshots__source`(`project_id`, `source_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `conversation_quote_snapshots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `quote_key` VARCHAR(64) NOT NULL,
    `node_id` VARCHAR(128) NOT NULL,
    `source_json` JSON NULL,
    `title` VARCHAR(200) NOT NULL,
    `text` MEDIUMTEXT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_conversation_quote`(`project_id`, `quote_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_material_info` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `material_id` VARCHAR(128) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `material_group_id` VARCHAR(128) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `error_code` VARCHAR(128) NULL,
    `error_message` VARCHAR(512) NULL,
    `status_checked_at` DATETIME(0) NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `idx_user_material_info__poll`(`status`, `gmt_create`),
    INDEX `idx_user_material_info__group`(`material_group_id`),
    UNIQUE INDEX `uk_user_material_info__material`(`material_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generation_canvas_submissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `protocol_version` INTEGER NOT NULL,
    `submission_id` VARCHAR(36) NOT NULL,
    `operation` VARCHAR(64) NOT NULL,
    `request_hash` VARCHAR(64) NOT NULL,
    `generation_job_id` BIGINT NOT NULL,
    `task_type` VARCHAR(32) NOT NULL,
    `target_node_id` VARCHAR(128) NOT NULL,
    `binding_revision` INTEGER NOT NULL,
    `recovery_seed` JSON NULL,
    `previous_target_snapshot` JSON NULL,
    `target_state` VARCHAR(16) NOT NULL,
    `target_revision` INTEGER NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_submissions__submission`(`project_id`, `submission_id`),
    UNIQUE INDEX `uk_generation_canvas_submissions__binding`(`project_id`, `target_node_id`, `binding_revision`),
    INDEX `idx_generation_canvas_submissions__project`(`project_id`, `id`),
    INDEX `idx_generation_canvas_submissions__job`(`generation_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generation_canvas_outputs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `generation_canvas_submission_id` BIGINT NOT NULL,
    `output_key` VARCHAR(128) NOT NULL,
    `node_id` VARCHAR(128) NOT NULL,
    `asset_id` BIGINT NULL,
    `slot_id` BIGINT NULL,
    `state` VARCHAR(16) NOT NULL,
    `revision` INTEGER NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_outputs__key`(`generation_canvas_submission_id`, `output_key`),
    UNIQUE INDEX `uk_generation_canvas_outputs__node`(`generation_canvas_submission_id`, `node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generation_outbox` (
    `id`              BIGINT       NOT NULL AUTO_INCREMENT,
    `job_id`          BIGINT       NOT NULL,
    `user_id`         BIGINT       NOT NULL,
    `terminal_status` VARCHAR(32)  NOT NULL,
    `reason`          VARCHAR(512) NOT NULL DEFAULT '',
    `send_state`      VARCHAR(16)  NOT NULL DEFAULT 'pending',
    `attempts`        INT          NOT NULL DEFAULT 0,
    `gmt_create`      DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `sent_at`         DATETIME(0)  NULL,

    INDEX `idx_generation_outbox__pending`(`send_state`, `id`),
    INDEX `idx_generation_outbox__job`(`job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_nodes` (
    `id`           BIGINT       NOT NULL AUTO_INCREMENT,
    `project_id`   BIGINT       NOT NULL,
    `node_id`      VARCHAR(128) NOT NULL,
    `type`         VARCHAR(32)  NOT NULL,
    `name`         VARCHAR(255) NULL,
    `source`       VARCHAR(16)  NOT NULL DEFAULT 'user',
    `pos_x`        INT          NULL,
    `pos_y`        INT          NULL,
    `data_json`    JSON         NULL,
    `gmt_create`   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version`      INT          NOT NULL DEFAULT 0,
    `is_delete`    TINYINT      NOT NULL DEFAULT 0,
    `owner_submission_id`    BIGINT       NULL,
    `owner_output_key`       VARCHAR(128) NULL,
    `owner_binding_revision` INT          NOT NULL DEFAULT 0,
    UNIQUE INDEX `uk_project_nodes__node`(`project_id`, `node_id`),
    INDEX `idx_project_nodes__type`(`project_id`, `type`, `is_delete`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_edges` (
    `id`             BIGINT       NOT NULL AUTO_INCREMENT,
    `project_id`     BIGINT       NOT NULL,
    `edge_id`        VARCHAR(128) NOT NULL,
    `source_node_id` VARCHAR(128) NOT NULL,
    `target_node_id` VARCHAR(128) NOT NULL,
    `ref_role`       VARCHAR(16)  NULL,
    `data_json`      JSON         NULL,
    `gmt_create`     DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version`        INT          NOT NULL DEFAULT 0,
    `is_delete`      TINYINT      NOT NULL DEFAULT 0,
    UNIQUE INDEX `uk_project_edges__edge`(`project_id`, `edge_id`),
    UNIQUE INDEX `uk_project_edges__pair`(`project_id`, `source_node_id`, `target_node_id`),
    INDEX `idx_project_edges__source`(`project_id`, `source_node_id`),
    INDEX `idx_project_edges__target`(`project_id`, `target_node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_node_revisions` (
    `id`         BIGINT       NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT       NOT NULL,
    `node_id`    VARCHAR(128) NOT NULL,
    `revision`   INT          NOT NULL,
    `op`         VARCHAR(16)  NOT NULL,
    `actor`      VARCHAR(16)  NOT NULL,
    `actor_id`   VARCHAR(128) NULL,
    `changes`    JSON         NULL,
    `gmt_create` DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `uk_project_node_revisions__revision`(`project_id`, `node_id`, `revision`),
    INDEX `idx_project_node_revisions__project_time`(`project_id`, `gmt_create`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
