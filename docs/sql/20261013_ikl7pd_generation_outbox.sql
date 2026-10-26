SET NAMES utf8mb4;
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
