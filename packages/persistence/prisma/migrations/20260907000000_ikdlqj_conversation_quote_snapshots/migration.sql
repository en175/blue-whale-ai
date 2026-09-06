-- CreateTable
CREATE TABLE `conversation_quote_snapshots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `project_id` BIGINT NOT NULL,
    `quote_key` VARCHAR(64) NOT NULL,
    `node_id` VARCHAR(128) NOT NULL,
    `source_json` JSON NULL,
    `title` VARCHAR(200) NOT NULL,
    `text` MEDIUMTEXT NOT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX `uk_conversation_quote`(`project_id`, `quote_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
