-- 场景 4 夹具（IK1W1L）：模拟 GenerationJob/Asset 域停留在 pre-ik10i6 历史形态的旧库。
-- 灌入 MySQL initdb.d 后造出：
--   - 非本域表为 V1 完整形态（command_idempotency 等归相邻子 issue 的表不纳入本场景漂移）
--   - generation_jobs/assets 为初始历史形态（缺 ik10i6~ik10pt 后加列）
--   - generation_job_outputs、generation_provider_tasks、asset_storage_objects、
--     asset_object_transfers、generation_result_conflicts、seedance_callback_*、
--     cost_budget_locks、cost_reservations、audit_records、content_reviews 全部缺失
--   - 既有 Project/Canvas/GenerationJob/Asset 关联数据（id 9001/8001/6001/7001）
-- 期望：迁移器补记 V1、跑 V2 后，V3 原地收敛本域结构（建缺表、补缺列），
-- 既有数据与其关联保持不变，输出槽幂等回填，重复执行无副作用。

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
    nodes_json    JSON NULL COMMENT '节点数组 JSON：[{id,type,position,data:{assetId,...}}]',
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
    aggregate_version INT          NOT NULL DEFAULT 0 COMMENT '聚合版本（乐观锁版本，客户端拒绝旧状态）',
    correlation_id    VARCHAR(64)  NULL COMMENT '贯穿一条用户意图的追踪 ID',
    causation_id      VARCHAR(64)  NULL COMMENT '直接原因事件 ID',
    occurred_at       DATETIME     NOT NULL COMMENT '事件发生时间',
    payload           JSON         NULL COMMENT '事件 payload（封套内，具体事件结构）',
    gmt_create        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    gmt_modified      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
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

-- ===== generation 域历史形态（pre-ik10i6） =====
-- generation_jobs/assets 为初始结构（无 ik10i6~ik10pt 后加列），其余域表缺失。

CREATE TABLE IF NOT EXISTS generation_jobs
(
    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id       BIGINT NULL,
    user_id          BIGINT NOT NULL,
    agent_run_id     BIGINT NULL,
    action_identity  VARCHAR(128) NULL,
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
    gmt_create       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version          INT      NOT NULL DEFAULT 0,
    is_delete        TINYINT  NOT NULL DEFAULT 0,
    UNIQUE KEY uk_agent_run_action (agent_run_id, action_identity)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='生成任务事实（旧形态）';

CREATE TABLE IF NOT EXISTS assets
(
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id           BIGINT NOT NULL,
    type              VARCHAR(16) NOT NULL,
    storage_key       VARCHAR(512) NULL,
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
    is_delete         TINYINT NOT NULL DEFAULT 0
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='Asset 资源事实（旧形态）';

-- 既有业务事实：升级后这些行及其关联必须仍然存在（数据保留断言）
INSERT INTO project (id, owner_id, name) VALUES (9001, 1001, '验收-旧库-生成项目');
INSERT INTO canvas (id, project_id, nodes_json) VALUES
    (8001, 9001, '[{"id":"n1","type":"image","data":{"assetId":7001}}]');
INSERT INTO generation_jobs
    (id, project_id, user_id, type, source, status, progress, output_asset_ids, version)
    VALUES (6001, 9001, 1001, 'image', 'bottom_dock', 'succeeded', 100, '[7001]', 3);
INSERT INTO assets (id, user_id, type, storage_key, url, source, status, version)
    VALUES (7001, 1001, 'image', 'legacy/acc-7001.png', 'https://example.com/7001.png',
            'generated', 'normal', 2);
