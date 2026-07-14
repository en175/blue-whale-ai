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

CREATE TABLE IF NOT EXISTS generation_jobs
(
    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id       BIGINT  NULL,
    user_id          BIGINT  NOT NULL,
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
    is_delete        TINYINT  NOT NULL DEFAULT 0
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
    CONSTRAINT uk_event_id UNIQUE (event_id),
    CONSTRAINT uk_project_cursor UNIQUE (project_id, cursor)
);

CREATE INDEX idx_project_occurred ON project_events (project_id, occurred_at);

CREATE TABLE IF NOT EXISTS outbox_messages
(
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id      VARCHAR(64)  NOT NULL,
    aggregate_type  VARCHAR(32)  NOT NULL,
    aggregate_id    VARCHAR(64)  NOT NULL,
    event_type      VARCHAR(64)  NOT NULL,
    payload         CLOB NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    next_attempt_at DATETIME NULL,
    attempt_count   INT      NOT NULL DEFAULT 0,
    gmt_create      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_outbox_message_id UNIQUE (message_id)
);
