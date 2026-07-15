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

-- ============ Skill 面板（IJZ7Z8） ============
-- skill：技能库（权威内容），列名对齐 BaseEntity（gmt_create/gmt_modified/version/is_delete）
-- seed 来源 blue-whale-agent-workspace/skill/library/raw/*.md（60 条），见 data.sql

DROP TABLE IF EXISTS user_skill;
DROP TABLE IF EXISTS skill;

CREATE TABLE skill
(
    id          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    name        VARCHAR(255) NOT NULL COMMENT '展示名（文件名生成）',
    description TEXT         NULL COMMENT 'raw frontmatter description',
    content     LONGTEXT     NULL COMMENT 'md 全文（frontmatter + 正文）',
    source      VARCHAR(32)  NOT NULL DEFAULT 'official' COMMENT 'official/community',
    sort_order  INT          NOT NULL DEFAULT 0 COMMENT '排序：cn 编号',
    cover_url   VARCHAR(512) NULL COMMENT '封面 URL（P0 留空，走占位）',
    gmt_create  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version     INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本',
    is_delete   TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    UNIQUE INDEX uk_name (name),
    INDEX idx_sort (sort_order)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='技能库';

CREATE TABLE user_skill
(
    id          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    user_id     BIGINT       NOT NULL COMMENT '用户ID（X-User-Id）',
    skill_id    BIGINT       NOT NULL COMMENT '技能ID（→ skill.id）',
    auto        TINYINT      NOT NULL DEFAULT 0 COMMENT 'auto 开关：关系属性，0关 1开',
    gmt_create  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version     INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本',
    is_delete   TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    UNIQUE INDEX uk_user_skill (user_id, skill_id),
    INDEX idx_user (user_id),
    INDEX idx_skill (skill_id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='用户技能引用关系（auto 挂关系上）';

-- ===== 画布核心模块（ADR-0011 统一 project model）=====
-- project 为唯一根（owner_id 归属用户），canvas 与 project 1:1，整体存 nodes_json + viewport_json。
-- 审计列遵循 BaseEntity：gmt_create / gmt_modified / version / is_delete。

DROP TABLE IF EXISTS canvas;
DROP TABLE IF EXISTS project;

CREATE TABLE project
(
    id           BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    owner_id     BIGINT       NOT NULL COMMENT '归属用户 ID（来自 X-User-Id 头）',
    name         VARCHAR(128) NOT NULL COMMENT '项目名',
    thumb        VARCHAR(512) NULL COMMENT '缩略图 url',
    gmt_create   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version      INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    is_delete    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    INDEX idx_project_owner (owner_id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='画布项目（workspace 根）';

CREATE TABLE canvas
(
    id            BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    project_id    BIGINT       NOT NULL COMMENT '所属项目 ID',
    viewport_json JSON NULL COMMENT '视口 JSON：{x, y, zoom}',
    nodes_json    JSON NULL COMMENT '节点数组 JSON：[{id,type,position,data:{assetId,...}}]',
    gmt_create    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version       INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    is_delete     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    UNIQUE KEY uk_canvas_project (project_id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='画布状态（与 project 1:1，整体 JSON 透传）';

CREATE TABLE assets
(
    id           BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    user_id      BIGINT       NOT NULL COMMENT '归属用户 ID',
    project_id   BIGINT       NOT NULL DEFAULT 0 COMMENT '所属项目 ID',
    type         VARCHAR(16)  NOT NULL COMMENT '资源类型：image / video',
    storage_key  VARCHAR(512) NULL COMMENT '存储 key（TOS object key）',
    url          VARCHAR(1024) NULL COMMENT '可访问 url（TOS 公开地址）',
    mime         VARCHAR(64)  NULL COMMENT 'MIME',
    size         BIGINT       NULL COMMENT '字节',
    width        INT          NULL COMMENT '宽',
    height       INT          NULL COMMENT '高',
    duration     INT          NULL COMMENT '视频时长（秒）',
    source       VARCHAR(16)  NULL COMMENT '来源：generated / uploaded',
    status       VARCHAR(16)  NULL COMMENT '状态：normal / failed',
    gmt_create   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version      INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    is_delete    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    INDEX idx_asset_user (user_id),
    INDEX idx_asset_project (project_id),
    INDEX idx_asset_project_type (project_id, type)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='资源（图片/视频，生成输出或上传）';

-- ============ 模型能力注册表（configurable-multi-model / video-generation）============
-- generation_model_capability：每 provider+model 维度的生成能力参数（尺寸/比例/格式/特性开关）。
-- 后端/前端均按本表工作，避免硬编码模型差异；JSON 字段 JacksonTypeHandler 整存整取。
-- 种子见 data.sql（4 image Seedream + 1 video Seedance）。变更能力数据时同步改表 + data.sql。

DROP TABLE IF EXISTS generation_model_capability;

CREATE TABLE generation_model_capability
(
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    provider_id             VARCHAR(32)  NOT NULL COMMENT 'provider 标识，如 volcengine',
    model_id                VARCHAR(128) NOT NULL COMMENT '模型 ID，如 doubao-seedream-5-0-260128',
    capability_type         VARCHAR(16)  NOT NULL COMMENT '能力类型：image / video',
    model_label             VARCHAR(64)  NOT NULL COMMENT '前端展示名',
    icon                    VARCHAR(512) NULL COMMENT '模型图标 URL',
    supported_sizes         JSON         NOT NULL COMMENT '尺寸选项 [{id,label,api_value,width,height}]',
    supported_aspect_ratios JSON         NOT NULL COMMENT '宽高比列表，如 ["1:1","16:9"]',
    supported_formats       JSON         NOT NULL COMMENT '输出格式，如 ["png","jpeg"]；空数组不支持自定义',
    default_size            VARCHAR(32)  NOT NULL COMMENT '默认 size_id',
    default_format          VARCHAR(16)  NULL COMMENT '默认输出格式',
    default_aspect_ratio    VARCHAR(16)  NOT NULL COMMENT '默认宽高比',
    features                JSON         NOT NULL COMMENT '特性开关 {reference_image,watermark,quantity_max,sequential_image_generation,stream,tools}',
    enabled                 TINYINT      NOT NULL DEFAULT 1 COMMENT '是否启用：0关 1开',
    gmt_create              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version                 INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    is_delete               TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    UNIQUE INDEX uk_provider_model (provider_id, model_id),
    INDEX idx_capability_type (capability_type, enabled)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='模型能力注册表（provider+model 维度的生成能力参数）';
