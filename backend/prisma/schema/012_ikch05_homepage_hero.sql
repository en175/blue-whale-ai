SET NAMES utf8mb4;
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
