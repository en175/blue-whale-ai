SET NAMES utf8mb4;

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

ALTER TABLE `canvas` RENAME INDEX `uk_canvas_project` TO `uk_project_canvas__project`;
ALTER TABLE `prompt_preview_snapshots` RENAME INDEX `uk_prompt_preview_source` TO `uk_project_prompt_preview_snapshots__source`;
RENAME TABLE `canvas` TO `project_canvas`, `prompt_preview_snapshots` TO `project_prompt_preview_snapshots`;
