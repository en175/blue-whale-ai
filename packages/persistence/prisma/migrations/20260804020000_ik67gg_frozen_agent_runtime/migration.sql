-- AlterTable
ALTER TABLE `agent_runs`
    ADD COLUMN `run_pin` JSON NULL,
    ADD COLUMN `activated_creative_skill_versions` JSON NULL,
    ADD COLUMN `reasoning_summary` VARCHAR(280) NULL;

-- CreateTable
CREATE TABLE `agent_advances` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `agent_run_id` BIGINT NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `input_snapshot` JSON NOT NULL,
    `input_high_watermark_sequence_no` INTEGER NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_agent_advance_run`(`agent_run_id`),
    INDEX `idx_agent_advance_run_status`(`agent_run_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `run_commits` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `advance_id` BIGINT NOT NULL,
    `agent_run_id` BIGINT NOT NULL,
    `request_digest` VARCHAR(71) NOT NULL,
    `outcome` VARCHAR(16) NOT NULL,
    `receipt` JSON NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_run_commit_advance`(`advance_id`),
    INDEX `idx_run_commit_agent_run`(`agent_run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
