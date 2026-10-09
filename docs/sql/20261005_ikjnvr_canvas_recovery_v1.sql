

SET NAMES utf8mb4;

ALTER TABLE `command_idempotency`
  ADD COLUMN `result_payload` JSON NULL AFTER `resource_id`;

CREATE TABLE `generation_canvas_submissions` (
    `id`                       BIGINT       NOT NULL AUTO_INCREMENT,
    `project_id`               BIGINT       NOT NULL,
    `user_id`                  BIGINT       NOT NULL,
    `protocol_version`         INT          NOT NULL,
    `submission_id`            VARCHAR(36)  NOT NULL,
    `operation`                VARCHAR(64)  NOT NULL,
    `request_hash`             VARCHAR(64)  NOT NULL,
    `generation_job_id`        BIGINT       NOT NULL,
    `task_type`                VARCHAR(32)  NOT NULL,
    `target_node_id`           VARCHAR(128) NOT NULL,
    `binding_revision`         INT          NOT NULL,
    `recovery_seed`            JSON         NULL,
    `previous_target_snapshot` JSON         NULL,
    `target_state`             VARCHAR(16)  NOT NULL,
    `target_revision`          INT          NOT NULL,
    `gmt_create`               DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`             DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_submissions__submission`(`project_id`, `submission_id`),
    UNIQUE INDEX `uk_generation_canvas_submissions__binding`(`project_id`, `target_node_id`, `binding_revision`),
    INDEX `idx_generation_canvas_submissions__project`(`project_id`, `id`),
    INDEX `idx_generation_canvas_submissions__job`(`generation_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generation_canvas_outputs` (
    `id`                              BIGINT       NOT NULL AUTO_INCREMENT,
    `generation_canvas_submission_id` BIGINT       NOT NULL,
    `output_key`                      VARCHAR(128) NOT NULL,
    `node_id`                         VARCHAR(128) NOT NULL,
    `asset_id`                        BIGINT       NULL,
    `slot_id`                         BIGINT       NULL,
    `state`                           VARCHAR(16)  NOT NULL,
    `revision`                        INT          NOT NULL,
    `gmt_create`                      DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`                    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_outputs__key`(`generation_canvas_submission_id`, `output_key`),
    UNIQUE INDEX `uk_generation_canvas_outputs__node`(`generation_canvas_submission_id`, `node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generation_canvas_node_owners` (
    `id`                              BIGINT       NOT NULL AUTO_INCREMENT,
    `project_id`                      BIGINT       NOT NULL,
    `node_id`                         VARCHAR(128) NOT NULL,
    `generation_canvas_submission_id` BIGINT       NOT NULL,
    `output_key`                      VARCHAR(128) NOT NULL,
    `binding_revision`                INT          NOT NULL,
    `gmt_create`                      DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`                    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_node_owners__node`(`project_id`, `node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
