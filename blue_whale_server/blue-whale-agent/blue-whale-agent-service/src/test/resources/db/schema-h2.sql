-- H2（MODE=MySQL）集成测试建表脚本。
-- 与 db/schema.sql 对齐，但去掉 MySQL 专有语法（ENGINE/CHARSET/COMMENT/JSON→CLOB/ON UPDATE）。
-- 仅用于 SnapshotSseRecoveryIT，生产以 db/schema.sql 为准。

CREATE TABLE IF NOT EXISTS project
(
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    owner_id     BIGINT       NOT NULL,
    name         VARCHAR(128) NOT NULL,
    thumb        VARCHAR(512) NULL,
    gmt_create   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version      INT          NOT NULL DEFAULT 0,
    is_delete    TINYINT      NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS canvas
(
    id            BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id    BIGINT       NOT NULL,
    viewport_json CLOB NULL,
    nodes_json    CLOB NULL,
    gmt_create    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version       INT          NOT NULL DEFAULT 0,
    is_delete     TINYINT      NOT NULL DEFAULT 0,
    CONSTRAINT uk_canvas_project UNIQUE (project_id)
);

CREATE TABLE IF NOT EXISTS conversations
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_conversation_project UNIQUE (project_id)
);

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
    lease_owner VARCHAR(128) NULL,
    lease_expires_at DATETIME NULL,
    fencing_token BIGINT NOT NULL DEFAULT 0,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_run_claim
    ON agent_runs (status, engine, is_delete, id);

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
    opaque_payload CLOB NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_checkpoint_sequence UNIQUE (agent_run_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS run_commits
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    agent_run_id BIGINT NOT NULL,
    commit_id VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    checkpoint_id BIGINT NOT NULL,
    generation_job_id BIGINT NOT NULL,
    committed_cursor BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_run_commit UNIQUE (agent_run_id, commit_id)
);

CREATE TABLE IF NOT EXISTS conversation_messages
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    agent_run_id BIGINT NULL,
    client_message_id VARCHAR(64) NULL,
    role VARCHAR(16) NOT NULL,
    content CLOB NOT NULL,
    sequence_no INT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_conversation_sequence UNIQUE (conversation_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS command_idempotency
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    operation VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    message_id BIGINT NOT NULL,
    agent_run_id BIGINT NOT NULL,
    accepted_cursor BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_command_idempotency UNIQUE (project_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS generation_jobs
(
    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id       BIGINT  NULL,
    user_id          BIGINT  NOT NULL,
    agent_run_id     BIGINT NULL,
    action_identity  VARCHAR(128) NULL,
    type             VARCHAR(32)  NOT NULL,
    source           VARCHAR(32)  NOT NULL,
    input            CLOB NULL,
    status           VARCHAR(32)  NOT NULL,
    progress         INT NULL,
    output_asset_ids CLOB NULL,
    provider         VARCHAR(64)  NULL,
    provider_task_id VARCHAR(128) NULL,
    poll_count       INT NULL,
    next_poll_at     DATETIME NULL,
    retry_count      INT NULL,
    last_polled_at   DATETIME NULL,
    error            CLOB NULL,
    stage_id         VARCHAR(64)  NULL,
    gmt_create       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version          INT      NOT NULL DEFAULT 0,
    is_delete        TINYINT  NOT NULL DEFAULT 0,
    CONSTRAINT uk_agent_run_action UNIQUE (agent_run_id, action_identity)
);

CREATE TABLE IF NOT EXISTS assets
(
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id     BIGINT       NOT NULL,
    type        VARCHAR(16)  NOT NULL,
    storage_key VARCHAR(512) NULL,
    url         VARCHAR(1024) NULL,
    mime        VARCHAR(128) NULL,
    size        BIGINT NULL,
    width       INT NULL,
    height      INT NULL,
    duration    INT NULL,
    source      VARCHAR(32)  NOT NULL,
    status      VARCHAR(32)  NOT NULL,
    gmt_create  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version     INT      NOT NULL DEFAULT 0,
    is_delete   TINYINT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_event_stream
(
    project_id     BIGINT PRIMARY KEY,
    high_watermark BIGINT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS project_events
(
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id        BIGINT       NOT NULL,
    cursor            BIGINT       NOT NULL,
    event_id          VARCHAR(64)  NOT NULL,
    event_type        VARCHAR(64)  NOT NULL,
    aggregate_type    VARCHAR(32)  NOT NULL,
    aggregate_id      VARCHAR(64)  NOT NULL,
    aggregate_version INT          NOT NULL DEFAULT 0,
    correlation_id    VARCHAR(64)  NULL,
    causation_id      VARCHAR(64)  NULL,
    occurred_at       DATETIME     NOT NULL,
    payload           CLOB NULL,
    gmt_create        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version           INT          NOT NULL DEFAULT 0,
    is_delete         TINYINT      NOT NULL DEFAULT 0,
    CONSTRAINT uk_event_id UNIQUE (event_id),
    CONSTRAINT uk_project_cursor UNIQUE (project_id, cursor)
);

CREATE INDEX IF NOT EXISTS idx_project_occurred ON project_events (project_id, occurred_at);

CREATE TABLE IF NOT EXISTS outbox_messages
(
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id      VARCHAR(64)  NOT NULL,
    project_id      BIGINT       NOT NULL,
    cursor          BIGINT       NOT NULL,
    aggregate_type  VARCHAR(32)  NOT NULL,
    aggregate_id    VARCHAR(64)  NOT NULL,
    event_type      VARCHAR(64)  NOT NULL,
    payload         CLOB NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    next_attempt_at DATETIME NULL,
    attempt_count   INT      NOT NULL DEFAULT 0,
    gmt_create      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version         INT      NOT NULL DEFAULT 0,
    is_delete       TINYINT  NOT NULL DEFAULT 0,
    CONSTRAINT uk_outbox_message_id UNIQUE (message_id)
);
