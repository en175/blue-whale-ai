-- 重建（含审计字段：create_time / update_time / deleted）
-- 标签不再入表，元数据见 TemplateTagEnum 枚举；本文件仅建卡片与图片表
-- 手动执行：先跑本文件，再跑 data.sql

DROP TABLE IF EXISTS template_card_image;
DROP TABLE IF EXISTS template_card;

CREATE TABLE template_card
(
    id          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    tag_code    VARCHAR(64)  NOT NULL COMMENT '所属标签',
    title       VARCHAR(255) NOT NULL COMMENT '卡片标题',
    video_url   VARCHAR(512) NULL COMMENT '视频地址',
    layout      VARCHAR(32)  NOT NULL COMMENT '布局：wide/portrait/social/image',
    sort_order  INT          NOT NULL DEFAULT 0 COMMENT '排序',
    create_time DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    update_time DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    INDEX idx_tag_code (tag_code),
    INDEX idx_tag_sort (tag_code, sort_order)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='模板卡片';

CREATE TABLE template_card_image
(
    id          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    card_id     BIGINT       NOT NULL COMMENT '卡片ID',
    image_url   VARCHAR(512) NOT NULL COMMENT '图片地址',
    sort_order  INT          NOT NULL DEFAULT 0 COMMENT '排序',
    create_time DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    update_time DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    INDEX idx_card_id (card_id),
    INDEX idx_card_sort (card_id, sort_order)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='卡片图片';
