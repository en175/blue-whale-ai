-- IK9QKP：画布共享资产。用户主动保存、跨项目可复用的自包含快照库。
-- 两层类型对齐画布节点结构：asset_type = 节点大类（card/media/goods/scene/text），
-- kind = 节点判别字段（card 的 data.kind / media 的 data.mediaType；goods/scene/text 为 NULL）。
-- snapshot 统一存各类型全部数据（自包含，不依赖来源表）；name/thumbnail_url 为列表查询冗余列。
-- dedup_key 幂等去重：媒体 url sha256、卡片 类型+描述 sha256、商品 名称 sha256、场景 内容 sha256、文本 NULL。
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
