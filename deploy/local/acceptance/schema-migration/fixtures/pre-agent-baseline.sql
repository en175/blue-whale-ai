-- 场景 pre-agent 夹具（IK1W1J）：模拟早于 Agent 持久化实现的旧库。
-- 含 V1 全部非 Agent 表 + user-service 的 users 表与既有业务数据，
-- 但缺失全部七张 Agent 运行表（conversations / agent_runs / runtime_checkpoints /
-- run_commits / user_input_requests / conversation_messages / command_idempotency），
-- 且无 schema_migrations 记账本。
-- 迁移器补记 V1（不重放 DDL）后，V3 必须建出七张 Agent 表；
-- 既有 users / project / canvas 数据（id 8001 / 9001 / 9002）必须保留。

CREATE TABLE IF NOT EXISTS users (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    phone           VARCHAR(20)  NOT NULL,
    username        VARCHAR(50)  NOT NULL,
    status          VARCHAR(30)  NOT NULL DEFAULT 'NORMAL',
    gmt_create      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version         INT          NOT NULL DEFAULT 1,
    is_delete       TINYINT(1)   NOT NULL DEFAULT 0,
    UNIQUE INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS template_card
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

CREATE TABLE IF NOT EXISTS template_card_image
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

CREATE TABLE IF NOT EXISTS skill
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

CREATE TABLE IF NOT EXISTS user_skill
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

CREATE TABLE IF NOT EXISTS project
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

CREATE TABLE IF NOT EXISTS canvas
(
    id            BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    project_id    BIGINT       NOT NULL COMMENT '所属项目 ID',
    viewport_json JSON NULL COMMENT '视口 JSON：{x, y, zoom}',
    nodes_json    JSON NULL COMMENT '节点数组 JSON',
    gmt_create    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    version       INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    is_delete     TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    UNIQUE KEY uk_canvas_project (project_id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='画布状态（与 project 1:1，整体 JSON 透传）';

CREATE TABLE IF NOT EXISTS project_event_stream
(
    project_id     BIGINT PRIMARY KEY COMMENT '所属项目 ID（与 project.id 对齐）',
    high_watermark BIGINT NOT NULL DEFAULT 0 COMMENT '当前高水位游标（已分配的最大 cursor）'
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='Project 事件流高水位（游标分配锁点，无审计列）';

CREATE TABLE IF NOT EXISTS project_events
(
    id                BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    project_id        BIGINT       NOT NULL COMMENT '所属项目 ID',
    `cursor`          BIGINT       NOT NULL COMMENT 'Project 内单调递增游标（SSE id）',
    event_id          VARCHAR(64)  NOT NULL COMMENT '事件唯一标识（evt_ 前缀）',
    event_type        VARCHAR(64)  NOT NULL COMMENT '事件类型（如 project.created）',
    aggregate_type    VARCHAR(32)  NOT NULL COMMENT '聚合类型（project/generation_job）',
    aggregate_id      VARCHAR(64)  NOT NULL COMMENT '聚合 ID（字符串化）',
    aggregate_version INT          NOT NULL DEFAULT 0 COMMENT '聚合版本',
    correlation_id    VARCHAR(64)  NULL COMMENT '贯穿一条用户意图的追踪 ID',
    causation_id      VARCHAR(64)  NULL COMMENT '直接原因事件 ID',
    occurred_at       DATETIME     NOT NULL COMMENT '事件发生时间',
    payload           JSON         NULL COMMENT '事件 payload',
    gmt_create        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
    version           INT          NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
    is_delete         TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    UNIQUE KEY uk_event_id (event_id),
    UNIQUE KEY uk_project_cursor (project_id, `cursor`),
    INDEX idx_project_occurred (project_id, occurred_at)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4 COMMENT ='持久化产品事件日志（ADR-0016 封套）';

CREATE TABLE IF NOT EXISTS outbox_messages
(
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    message_id      VARCHAR(64)  NOT NULL COMMENT '消息稳定 ID（消费者按此去重）',
    project_id      BIGINT       NOT NULL COMMENT '所属项目 ID',
    `cursor`        BIGINT       NOT NULL COMMENT 'Project 内事件游标',
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

CREATE TABLE IF NOT EXISTS generation_job_outputs
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
    slot_index INT NOT NULL,
    asset_id BIGINT NULL,
    delivery_id VARCHAR(128) NULL,
    content_sha256 VARCHAR(64) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    error JSON NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_generation_output_slot (generation_job_id, slot_index),
    UNIQUE KEY uk_generation_output_delivery (generation_job_id, delivery_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='GenerationJob 输出槽事实';

CREATE TABLE IF NOT EXISTS asset_storage_objects
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    storage_key VARCHAR(512) NOT NULL,
    content_sha256 VARCHAR(64) NULL,
    source VARCHAR(32) NOT NULL,
    state VARCHAR(32) NOT NULL,
    active_transfer_count INT NOT NULL DEFAULT 0,
    first_unreferenced_at DATETIME NULL,
    delete_owner VARCHAR(128) NULL,
    delete_lease_expires_at DATETIME NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_asset_storage_object_key (storage_key),
    INDEX idx_asset_storage_gc (state, active_transfer_count, first_unreferenced_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Asset 不可变存储对象生命周期';

CREATE TABLE IF NOT EXISTS asset_object_transfers
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    transfer_token VARCHAR(64) NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    status VARCHAR(32) NOT NULL,
    expires_at DATETIME NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_asset_object_transfer_token (transfer_token),
    INDEX idx_asset_transfer_expiry (status, expires_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Asset 存储上传活跃传输';

CREATE TABLE IF NOT EXISTS generation_result_conflicts
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

CREATE TABLE IF NOT EXISTS generation_provider_tasks
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
    slot_index INT NOT NULL,
    provider VARCHAR(64) NOT NULL,
    account_id VARCHAR(128) NOT NULL,
    provider_task_id VARCHAR(128) NULL,
    submission_state VARCHAR(32) NOT NULL,
    provider_status VARCHAR(32) NULL,
    callback_capability_digest VARCHAR(64) NOT NULL,
    raw_status VARCHAR(64) NULL,
    raw_error_code VARCHAR(128) NULL,
    raw_error_message TEXT NULL,
    temporary_result_url VARCHAR(2048) NULL,
    observe_count INT NOT NULL DEFAULT 0,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_provider_task_job_slot (generation_job_id, slot_index),
    UNIQUE KEY uk_provider_task_ref (provider, account_id, provider_task_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='GenerationJob 供应商内部证据';

CREATE TABLE IF NOT EXISTS seedance_callback_inbox
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
    provider VARCHAR(64) NOT NULL,
    account_id VARCHAR(128) NOT NULL,
    provider_task_id VARCHAR(128) NOT NULL,
    dedup_key VARCHAR(64) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_seedance_callback_dedup (dedup_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Seedance callback 去重 Inbox';

CREATE TABLE IF NOT EXISTS seedance_callback_security_audits
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NULL,
    account_id VARCHAR(128) NULL,
    provider_task_id VARCHAR(128) NULL,
    reason VARCHAR(64) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='无效 callback 安全审计';

CREATE TABLE IF NOT EXISTS cost_budget_locks
(
    scope_key VARCHAR(160) PRIMARY KEY,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS cost_reservations
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    action_identity VARCHAR(128) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    provider VARCHAR(64) NOT NULL,
    reserved_amount_fen BIGINT NOT NULL,
    actual_amount_fen BIGINT NULL,
    status VARCHAR(32) NOT NULL,
    price_catalog_version VARCHAR(64) NOT NULL,
    exchange_rate_version VARCHAR(64) NOT NULL,
    model_policy_version VARCHAR(64) NOT NULL,
    cost_rule_version VARCHAR(64) NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_cost_reservation_job (generation_job_id),
    KEY idx_cost_project_window (project_id, gmt_create),
    KEY idx_cost_user_window (user_id, gmt_create),
    KEY idx_cost_provider_window (provider, gmt_create)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS audit_records
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    actor_user_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    action VARCHAR(128) NOT NULL,
    decision VARCHAR(32) NOT NULL,
    reason_code VARCHAR(128) NOT NULL,
    policy_version VARCHAR(64) NOT NULL,
    price_catalog_version VARCHAR(64) NULL,
    exchange_rate_version VARCHAR(64) NULL,
    model_policy_version VARCHAR(64) NULL,
    cost_rule_version VARCHAR(64) NOT NULL,
    request_id VARCHAR(128) NOT NULL,
    correlation_id VARCHAR(128) NOT NULL,
    trace_id VARCHAR(128) NOT NULL,
    environment VARCHAR(64) NOT NULL,
    occurred_at DATETIME NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_correlation (correlation_id, id),
    KEY idx_audit_occurred (occurred_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS generation_jobs
(
    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id       BIGINT NULL,
    user_id          BIGINT NOT NULL,
    agent_run_id     BIGINT NULL,
    action_identity  VARCHAR(128) NULL,
    project_action_identity VARCHAR(128) NULL,
    expected_output_count INT NOT NULL DEFAULT 1,
    retry_of_job_id  BIGINT NULL,
    type             VARCHAR(32) NOT NULL,
    source           VARCHAR(32) NOT NULL,
    input            JSON NULL,
    status           VARCHAR(32) NOT NULL,
    progress         INT NULL,
    output_asset_ids JSON NULL,
    provider         VARCHAR(64) NULL,
    provider_task_id VARCHAR(128) NULL,
    poll_count       INT NULL,
    next_poll_at     DATETIME NULL,
    retry_count      INT NULL,
    last_polled_at   DATETIME NULL,
    error            TEXT NULL,
    stage_id         VARCHAR(64) NULL,
    lease_owner      VARCHAR(128) NULL,
    lease_expires_at DATETIME NULL,
    fencing_token    BIGINT NOT NULL DEFAULT 0,
    strategy_version VARCHAR(64) NULL,
    execution_deadline_at DATETIME NULL,
    evidence_reconcile_until DATETIME NULL,
    next_action_at DATETIME NULL,
    cancel_requested_at DATETIME NULL,
    gmt_create       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version          INT      NOT NULL DEFAULT 0,
    is_delete        TINYINT  NOT NULL DEFAULT 0,
    UNIQUE KEY uk_agent_run_action (agent_run_id, action_identity),
    UNIQUE KEY uk_project_action_identity (project_id, project_action_identity)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='生成任务事实';

CREATE TABLE IF NOT EXISTS assets
(
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id        BIGINT NULL,
    user_id           BIGINT NOT NULL,
    generation_job_id BIGINT NULL,
    type              VARCHAR(16) NOT NULL,
    storage_key       VARCHAR(512) NULL,
    content_sha256    VARCHAR(64) NULL,
    url               VARCHAR(1024) NULL,
    mime              VARCHAR(128) NULL,
    size              BIGINT NULL,
    width             INT NULL,
    height            INT NULL,
    duration          INT NULL,
    source            VARCHAR(32) NOT NULL,
    status            VARCHAR(32) NOT NULL,
    gmt_create        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version           INT NOT NULL DEFAULT 0,
    is_delete         TINYINT NOT NULL DEFAULT 0,
    INDEX idx_asset_project (project_id, id),
    INDEX idx_asset_generation_job (generation_job_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Asset 资源事实';

CREATE TABLE IF NOT EXISTS content_reviews
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    subject_type VARCHAR(32) NOT NULL,
    subject_id VARCHAR(128) NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    modality VARCHAR(16) NOT NULL,
    direction VARCHAR(16) NOT NULL,
    policy_version VARCHAR(64) NOT NULL,
    review_state VARCHAR(16) NOT NULL,
    decision VARCHAR(16) NULL,
    failure_code VARCHAR(32) NULL,
    reason_codes JSON NULL,
    evidence_ref VARCHAR(256) NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_content_review_identity (project_id, subject_type, subject_id, content_digest, modality, direction, policy_version)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='内容审核规范化决定事实';

-- 既有业务事实：升级后这些行必须仍然存在（数据保留断言）。
-- owner_id 8001 对齐 users.id，业务链路验证用 X-User-Id: 8001。
INSERT INTO users (id, phone, username) VALUES
    (8001, '13800000001', '验收旧用户');

INSERT INTO project (id, owner_id, name) VALUES
    (9001, 8001, '验收-旧库-项目A'),
    (9002, 8001, '验收-旧库-项目B');

INSERT INTO canvas (id, project_id, viewport_json, nodes_json) VALUES
    (9001, 9001, JSON_OBJECT('x', 0, 'y', 0, 'zoom', 1), JSON_ARRAY()),
    (9002, 9002, JSON_OBJECT('x', 10, 'y', 20, 'zoom', 2), JSON_ARRAY());
