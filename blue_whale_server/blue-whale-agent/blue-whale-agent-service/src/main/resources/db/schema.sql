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

-- ===== 产品事件流（ADR-0016 可重放事件流 + ADR-0017 §3 Project 游标）=====
-- project_event_stream：每个 Project 一行，持有高水位游标。产生事件的事务 SELECT ... FOR UPDATE
--   锁定该行分配连续游标，回滚则游标分配一并回滚（ADR-0017 §3）。
-- project_events：持久化产品事件日志，封套字段对齐 ADR-0016 §4。SSE 重放与 Snapshot 一致性的共同事实。
-- outbox_messages：Outbox（ADR-0017 §1/§2）。与产品事件同事务写入，后台重试发布稳定唤醒身份。

CREATE TABLE project_event_stream
(
    project_id     BIGINT PRIMARY KEY COMMENT '所属项目 ID（与 project.id 对齐）',
    high_watermark BIGINT NOT NULL DEFAULT 0 COMMENT '当前高水位游标（已分配的最大 cursor）'
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='Project 事件流高水位（游标分配锁点，无审计列）';

CREATE TABLE project_events
(
    id                BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    project_id        BIGINT       NOT NULL COMMENT '所属项目 ID',
    cursor            BIGINT       NOT NULL COMMENT 'Project 内单调递增游标（SSE id）',
    event_id          VARCHAR(64)  NOT NULL COMMENT '事件唯一标识（evt_ 前缀）',
    event_type        VARCHAR(64)  NOT NULL COMMENT '事件类型（如 project.created）',
    aggregate_type    VARCHAR(32)  NOT NULL COMMENT '聚合类型（project/generation_job）',
    aggregate_id      VARCHAR(64)  NOT NULL COMMENT '聚合 ID（字符串化）',
    aggregate_version INT          NOT NULL DEFAULT 0 COMMENT '聚合版本（乐观锁版本，客户端拒绝旧状态）',
    correlation_id    VARCHAR(64)  NULL COMMENT '贯穿一条用户意图的追踪 ID',
    causation_id      VARCHAR(64)  NULL COMMENT '直接原因事件 ID',
    occurred_at       DATETIME     NOT NULL COMMENT '事件发生时间',
    payload           JSON         NULL COMMENT '事件 payload（封套内，具体事件结构）',
    gmt_create        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
    version           INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    is_delete         TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    UNIQUE KEY uk_event_id (event_id),
    UNIQUE KEY uk_project_cursor (project_id, cursor),
    INDEX idx_project_occurred (project_id, occurred_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='持久化产品事件日志（ADR-0016 封套）';

CREATE TABLE outbox_messages
(
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    message_id      VARCHAR(64)  NOT NULL COMMENT '消息稳定 ID（消费者按此去重）',
    project_id      BIGINT       NOT NULL COMMENT '所属项目 ID',
    cursor          BIGINT       NOT NULL COMMENT 'Project 内事件游标',
    aggregate_type  VARCHAR(32)  NOT NULL COMMENT '聚合类型',
    aggregate_id    VARCHAR(64)  NOT NULL COMMENT '聚合 ID',
    event_type      VARCHAR(64)  NOT NULL COMMENT '事件类型',
    payload         JSON         NULL COMMENT '消息 payload',
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/published',
    next_attempt_at DATETIME     NULL COMMENT '下次允许重试时间',
    attempt_count   INT          NOT NULL DEFAULT 0 COMMENT '尝试次数',
    gmt_create      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version         INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    is_delete       TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    UNIQUE KEY uk_outbox_message_id (message_id),
    INDEX idx_outbox_status_next (status, next_attempt_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='Project 事件唤醒 Outbox（同事务写入、后台重试）';

-- ===== Conversation 与 AgentRun（IK10I5） =====
DROP TABLE IF EXISTS run_commits;
DROP TABLE IF EXISTS runtime_checkpoints;
DROP TABLE IF EXISTS command_idempotency;
DROP TABLE IF EXISTS conversation_messages;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS conversations;

CREATE TABLE conversations
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_conversation_project (project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Project 唯一 Conversation';

CREATE TABLE agent_runs
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    conversation_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    stage VARCHAR(32) NULL,
    engine VARCHAR(64) NOT NULL,
    engine_version VARCHAR(64) NOT NULL,
    adapter_schema_version INT NOT NULL,
    current_checkpoint_id BIGINT NULL,
    lease_owner VARCHAR(128) NULL,
    lease_expires_at DATETIME NULL,
    fencing_token BIGINT NOT NULL DEFAULT 0,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    INDEX idx_agent_run_project_status (project_id, status),
    INDEX idx_agent_run_claim (status, engine, is_delete, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='持久 AgentRun';

CREATE TABLE runtime_checkpoints
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    agent_run_id BIGINT NOT NULL,
    sequence_no INT NOT NULL,
    run_version INT NOT NULL,
    engine VARCHAR(64) NOT NULL,
    engine_version VARCHAR(64) NOT NULL,
    adapter_schema_version INT NOT NULL,
    payload_digest VARCHAR(64) NOT NULL,
    opaque_payload JSON NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_checkpoint_sequence (agent_run_id, sequence_no)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='AgentRun 不透明运行时检查点';

CREATE TABLE run_commits
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    agent_run_id BIGINT NOT NULL,
    commit_id VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    checkpoint_id BIGINT NOT NULL,
    generation_job_id BIGINT NULL,
    committed_cursor BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_run_commit (agent_run_id, commit_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='AgentRun 提交幂等结果';

CREATE TABLE conversation_messages
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    agent_run_id BIGINT NULL,
    client_message_id VARCHAR(64) NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    sequence_no INT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_conversation_sequence (conversation_id, sequence_no),
    INDEX idx_message_project (project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Conversation 消息事实';

CREATE TABLE command_idempotency
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    operation VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    message_id BIGINT NULL,
    agent_run_id BIGINT NULL,
    generation_job_id BIGINT NULL,
    accepted_cursor BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_command_idempotency (project_id, operation, idempotency_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='公开命令幂等接纳记录';

CREATE TABLE generation_job_outputs
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
    slot_index INT NOT NULL,
    asset_id BIGINT NOT NULL,
    delivery_id VARCHAR(128) NOT NULL,
    content_sha256 VARCHAR(64) NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_generation_output_slot (generation_job_id, slot_index),
    UNIQUE KEY uk_generation_output_delivery (generation_job_id, delivery_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='GenerationJob 输出槽事实';

CREATE TABLE generation_result_conflicts
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
    slot_index INT NOT NULL,
    attempted_delivery_id VARCHAR(128) NOT NULL,
    expected_content_sha256 VARCHAR(64) NOT NULL,
    actual_content_sha256 VARCHAR(64) NOT NULL,
    reason VARCHAR(64) NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    INDEX idx_generation_result_conflict (generation_job_id, slot_index)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='结果身份冲突诊断事实';
