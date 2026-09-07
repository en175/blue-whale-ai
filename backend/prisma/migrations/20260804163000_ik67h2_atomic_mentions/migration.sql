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
