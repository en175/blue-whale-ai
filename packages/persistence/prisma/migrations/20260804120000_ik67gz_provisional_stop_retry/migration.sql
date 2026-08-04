-- AlterTable
ALTER TABLE `agent_runs`
    ADD COLUMN `retry_count` INTEGER NOT NULL DEFAULT 0 AFTER `failure_message`;

-- CreateTable
CREATE TABLE `agent_provisional_deliveries` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `agent_run_id` BIGINT NOT NULL,
    `advance_id` BIGINT NOT NULL,
    `fencing_token` BIGINT NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `interruption_reason` VARCHAR(32) NULL,
    `content` TEXT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_provisional_delivery_run`(`agent_run_id`),
    INDEX `idx_provisional_delivery_advance`(`advance_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_provisional_chunks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `delivery_id` BIGINT NOT NULL,
    `chunk_index` INTEGER NOT NULL,
    `content` TEXT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_provisional_chunk`(`delivery_id`, `chunk_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_provider_calls` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `agent_run_id` BIGINT NOT NULL,
    `advance_id` BIGINT NOT NULL,
    `call_slot` INTEGER NOT NULL,
    `fencing_token` BIGINT NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `request_digest` VARCHAR(71) NOT NULL,
    `result_payload` JSON NULL,
    `failure_code` VARCHAR(128) NULL,
    `failure_message` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_provider_call_slot`(`advance_id`, `call_slot`),
    INDEX `idx_provider_call_run`(`agent_run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
