-- Blue-Whale 集成测试用全量 MySQL DDL（刀1 Testcontainers 安全网）。
-- 来源：backend/prisma/schema.prisma（权威 schema，勿手改）。
-- 再生成：cd backend && sed 's|provider = "mysql"|& url = env("DATABASE_URL")|' \
--   prisma/schema.prisma > /tmp/schema-diff.prisma && \
--   DATABASE_URL=... npx prisma@6.5.0 migrate diff --from-empty --to-schema-datamodel /tmp/schema-diff.prisma --script
-- 生成日期：2026-09-12
-- 2026-09-15（IKFYHJ）手工追加 material_assets 表——追加内容逐字取自
--   backend/prisma/migrations/20260915170000_ikfyhj_material_compliance/migration.sql
--   （该 DDL 已由 backend 侧 ikfyhj-parity.test.ts 与 schema.prisma 对账）。
--   按上面命令全量再生成时，该表会按 prisma 的模型顺序重新出现在文件中间，不冲突。
-- 2026-09-24（IKI8AZ）手工追加 assets.name 列——取自
--   backend/prisma/migrations/20260923153000_iki8az_asset_name/migration.sql。
-- 2026-09-25（ADR-0114）：同批追加的**用户凭证表**已从本夹具删除——worker 侧不再按 userId 取
--   上游凭证，本夹具只服务 worker 测试，没有 worker 代码访问的表不必留。该表在生产库仍由
--   backend/prisma 持有，故全量再生成时它会照原样回来——回来也不必管，与 worker 无关。
-- 2026-09-25（IKC 上游 key 入配置表）：`system_settings` **没有**加进本夹具。本夹具只服务
--   不启动 Spring 上下文的单元测试，没有任何用例经真实 DB 走 SystemSettingMapper；
--   若将来出现起容器的集成用例，须按 backend/prisma 的 DDL 逐字补上该表。
-- CreateTable
CREATE TABLE `assets` (
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
    `material_group_id` VARCHAR(128) NULL,
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
    INDEX `idx_asset_material_group`(`material_group_id`),
    UNIQUE INDEX `uq_asset_material_id`(`material_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `material_groups` (
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

-- CreateTable
CREATE TABLE `shared_assets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `asset_type` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(16) NULL,
    `name` VARCHAR(255) NOT NULL,
    `thumbnail_url` VARCHAR(512) NULL,
    `snapshot` JSON NOT NULL,
    `dedup_key` VARCHAR(128) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'normal',
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_shared_user_type`(`user_id`, `asset_type`, `kind`, `is_delete`),
    INDEX `idx_shared_user_created`(`user_id`, `gmt_create`),
    UNIQUE INDEX `uk_shared_user_dedup`(`user_id`, `dedup_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `canvas` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `viewport_json` JSON NULL,
    `nodes_json` JSON NULL,
    `edges_json` JSON NULL,
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
    -- 2026-09-29（IKIZQC）成片来源唯一约束——逐字取自
    --   backend/prisma/migrations/20260929130000_generation_jobs_finalize_source_unique/migration.sql。
    -- ⚠️ 2026-09-30（IKJCOE）本表 DROP 了 15 列（7 死列 + 8 列搬进 generation_job_extras，
    --   含 idx_status_next_poll 索引）；本副本必须与 backend/prisma/migrations/
    --   20260930150000_generation_job_extras/migration.sql 的删列段保持一致。
    UNIQUE INDEX `uk_generation_jobs__source_sample_job_id`(`source_sample_job_id`),

    INDEX `idx_project_id`(`project_id`),
    INDEX `idx_provider_task_id`(`provider_task_id`),
    INDEX `idx_user_id`(`user_id`),
    INDEX `idx_generation_next_action`(`next_action_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2026-09-30（IKJCOE）任务特有字段的扩展位表——建表段逐字取自
--   backend/prisma/migrations/20260930150000_generation_job_extras/migration.sql。
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
    `input_sequence_no` INTEGER NOT NULL DEFAULT 0,
    `lease_owner` VARCHAR(128) NULL,
    `lease_expires_at` DATETIME(0) NULL,
    `fencing_token` BIGINT NOT NULL DEFAULT 0,
    `terminal_reason` VARCHAR(64) NULL,
    `failure_code` VARCHAR(128) NULL,
    `failure_message` TEXT NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
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
    -- 2026-10-03（IKJJQU）新协议保存（SAVE_CANVAS_RECOVERY_V1）的紧凑回执列——
    --   逐字取自 backend/prisma/migrations/20261003000000_ikjjqu_canvas_recovery_v1/migration.sql 的增列段。
    `result_payload` JSON NULL,
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
    `correlation_id` VARCHAR(128) NULL,
    `causation_id` VARCHAR(128) NULL,
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

-- CreateTable
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
    `auto_match` INTEGER NOT NULL DEFAULT 0,
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

    INDEX `idx_tier_status_sort`(`status`, `sort_order`),
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
    `release_note` VARCHAR(255) NULL,
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
CREATE TABLE `cost_adjustments` (
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
-- CreateTable
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

-- CreateTable
CREATE TABLE `scene_card_generation_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `scene_card_id` BIGINT NOT NULL,
    `project_id` BIGINT NOT NULL,
    `summary_status` VARCHAR(16) NOT NULL,
    `plan_message_id` BIGINT NULL,
    `application_receipt_id` BIGINT NULL,
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

-- CreateTable
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

-- CreateTable
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

    INDEX `idx_storyboard_scene`(`scene_card_id`),
    INDEX `idx_storyboard_project`(`project_id`),
    UNIQUE INDEX `uk_storyboard_command`(`project_id`, `command_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prompt_preview_snapshots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `source_key` VARCHAR(64) NOT NULL,
    `source_json` JSON NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `text` MEDIUMTEXT NOT NULL,
    `content_json` JSON NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_prompt_preview_source`(`project_id`, `source_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

-- CreateTable
CREATE TABLE `legacy_card_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `node_id` VARCHAR(128) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `prompt_text` MEDIUMTEXT NOT NULL,
    `visual_text` MEDIUMTEXT NULL,
    `source_json` JSON NULL,
    `card_json` JSON NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_legacy_card_history`(`project_id`, `node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `material_assets` (
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

    INDEX `idx_material_assets_poll`(`status`, `gmt_create`),
    INDEX `idx_material_assets_group`(`material_group_id`),
    UNIQUE INDEX `uk_material_assets_material`(`material_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2026-10-03（IKJJQU）生成任务恢复契约 v1 的三张关系表——建表段逐字取自
--   backend/prisma/migrations/20261003000000_ikjjqu_canvas_recovery_v1/migration.sql。
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

CREATE TABLE `generation_canvas_node_owners` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `node_id` VARCHAR(128) NOT NULL,
    `generation_canvas_submission_id` BIGINT NOT NULL,
    `output_key` VARCHAR(128) NOT NULL,
    `binding_revision` INTEGER NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_node_owners__node`(`project_id`, `node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
