-- V1 基线 Schema（IK1W1E）：所有表幂等建表（CREATE TABLE IF NOT EXISTS），
-- 由 SchemaMigrationService 作为 V1 迁移版本加载，空库建表、旧库（表已存在）跳过。
-- 表内容修复（模板旧字段、cursor 保留字等）由 IK1W1J/K/L/M 后续版本增量处理，本基线不动。

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

-- ============ Skill 面板（IJZ7Z8） ============
-- skill：技能库（权威内容），列名对齐 BaseEntity（gmt_create/gmt_modified/version/is_delete）
-- seed 来源 blue-whale-agent-workspace/skill/library/raw/*.md（60 条），见 data.sql


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

-- ===== 画布核心模块（ADR-0011 统一 project model）=====
-- project 为唯一根（owner_id 归属用户），canvas 与 project 1:1，整体存 nodes_json + viewport_json。
-- 审计列遵循 BaseEntity：gmt_create / gmt_modified / version / is_delete。


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

-- ===== Conversation 与 AgentRun（IK10I5） =====

CREATE TABLE IF NOT EXISTS conversations
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_conversation_project (project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Project 唯一 Conversation';

CREATE TABLE IF NOT EXISTS agent_runs
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
    confirmed_input_request_id BIGINT NULL,
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

CREATE TABLE IF NOT EXISTS runtime_checkpoints
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

CREATE TABLE IF NOT EXISTS run_commits
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    agent_run_id BIGINT NOT NULL,
    commit_id VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    checkpoint_id BIGINT NOT NULL,
    generation_job_id BIGINT NULL,
    user_input_request_id BIGINT NULL,
    committed_cursor BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_run_commit (agent_run_id, commit_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='AgentRun 提交幂等结果';

CREATE TABLE IF NOT EXISTS user_input_requests
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    request_type VARCHAR(32) NOT NULL DEFAULT 'cost_confirmation',
    conversation_id BIGINT NULL,
    source_agent_run_id BIGINT NULL,
    resumed_agent_run_id BIGINT NULL,
    request_target_type VARCHAR(64) NULL,
    question TEXT NULL,
    action_identity VARCHAR(128) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    arguments_digest VARCHAR(64) NOT NULL,
    quoted_amount_fen BIGINT NULL,
    quoted_provider VARCHAR(64) NULL,
    price_catalog_version VARCHAR(64) NULL,
    exchange_rate_version VARCHAR(64) NULL,
    model_policy_version VARCHAR(64) NULL,
    cost_rule_version VARCHAR(64) NULL,
    status VARCHAR(32) NOT NULL,
    expires_at DATETIME NOT NULL,
    confirmed_at DATETIME NULL,
    consumed_at DATETIME NULL,
    answer_message_id BIGINT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    INDEX idx_input_request_owner (project_id, user_id, status),
    UNIQUE KEY uk_input_request_resumed_run (resumed_agent_run_id),
    UNIQUE KEY uk_standalone_action_confirmation (
        project_id, user_id, request_target_type, action_identity)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='产品中性输入请求，归属 AgentRun，区分创作澄清与成本确认';

CREATE TABLE IF NOT EXISTS conversation_messages
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    agent_run_id BIGINT NULL,
    client_message_id VARCHAR(64) NULL,
    stream_id VARCHAR(128) NULL,
    role VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'completed',
    last_chunk_sequence INT NOT NULL DEFAULT 0,
    sequence_no INT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_conversation_sequence (conversation_id, sequence_no),
    UNIQUE KEY uk_conversation_stream (stream_id),
    INDEX idx_message_project (project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Conversation 消息事实';

CREATE TABLE IF NOT EXISTS assistant_message_streams
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    stream_id VARCHAR(128) NOT NULL,
    agent_run_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    conversation_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    message_id BIGINT NOT NULL,
    status VARCHAR(16) NOT NULL,
    last_sequence_no INT NOT NULL DEFAULT 0,
    released_sequence_no INT NOT NULL DEFAULT 0,
    start_idempotency_key VARCHAR(128) NOT NULL,
    complete_idempotency_key VARCHAR(128) NULL,
    content_digest VARCHAR(64) NULL,
    abort_idempotency_key VARCHAR(128) NULL,
    abort_reason_code VARCHAR(64) NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_assistant_stream_id (stream_id),
    INDEX idx_assistant_stream_run (agent_run_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Assistant 私有输出流状态';

CREATE TABLE IF NOT EXISTS assistant_message_chunks
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    assistant_message_stream_id BIGINT NOT NULL,
    sequence_no INT NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    content TEXT NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    released TINYINT NOT NULL DEFAULT 0,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_assistant_chunk_sequence (assistant_message_stream_id, sequence_no),
    UNIQUE KEY uk_assistant_chunk_idempotency (assistant_message_stream_id, idempotency_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Assistant 原始私有文本分块';

CREATE TABLE IF NOT EXISTS command_idempotency
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
    duration_ms       INT NULL,
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
