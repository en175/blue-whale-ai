SET NAMES utf8mb4;
CREATE TABLE `shared_assets` (
    `id`            BIGINT       NOT NULL AUTO_INCREMENT,
    `user_id`       BIGINT       NOT NULL,
    `asset_type`    VARCHAR(16)  NOT NULL,
    `kind`          VARCHAR(16)  NULL,
    `name`          VARCHAR(255) NOT NULL,
    `thumbnail_url` VARCHAR(512) NULL,
    `snapshot`      JSON         NOT NULL,
    `dedup_key`     VARCHAR(128) NULL,
    `status`        VARCHAR(16)  NOT NULL DEFAULT 'normal',
    `gmt_create`    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`  DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version`       INTEGER      NOT NULL DEFAULT 0,
    `is_delete`     TINYINT      NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_shared_user_dedup`(`user_id`, `dedup_key`),
    INDEX `idx_shared_user_type`(`user_id`, `asset_type`, `kind`, `is_delete`),
    INDEX `idx_shared_user_created`(`user_id`, `gmt_create`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
