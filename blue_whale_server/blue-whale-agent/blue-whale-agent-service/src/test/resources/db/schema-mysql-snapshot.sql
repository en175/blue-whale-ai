-- Snapshot MySQL 一致读 IT 的最小安全 schema。
-- 只能连接专用测试数据库；不 DROP、不清空已有表。

CREATE TABLE IF NOT EXISTS project
(
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    owner_id     BIGINT       NOT NULL,
    name         VARCHAR(128) NOT NULL,
    thumb        VARCHAR(512) NULL,
    gmt_create   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version      INT          NOT NULL DEFAULT 0,
    is_delete    TINYINT      NOT NULL DEFAULT 0,
    INDEX idx_project_owner (owner_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS canvas
(
    id            BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id    BIGINT NOT NULL,
    viewport_json JSON NULL,
    nodes_json    JSON NULL,
    gmt_create    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version       INT      NOT NULL DEFAULT 0,
    is_delete     TINYINT  NOT NULL DEFAULT 0,
    UNIQUE KEY uk_canvas_project (project_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS generation_jobs
(
    id               BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id       BIGINT NULL,
    user_id          BIGINT NOT NULL,
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
    is_delete        TINYINT  NOT NULL DEFAULT 0
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS project_event_stream
(
    project_id     BIGINT PRIMARY KEY,
    high_watermark BIGINT NOT NULL DEFAULT 0
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

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
    payload           JSON NULL,
    gmt_create        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version           INT          NOT NULL DEFAULT 0,
    is_delete         TINYINT      NOT NULL DEFAULT 0,
    UNIQUE KEY uk_event_id (event_id),
    UNIQUE KEY uk_project_cursor (project_id, cursor),
    INDEX idx_project_occurred (project_id, occurred_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS outbox_messages
(
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id      VARCHAR(64) NOT NULL,
    project_id      BIGINT      NOT NULL,
    cursor          BIGINT      NOT NULL,
    aggregate_type  VARCHAR(32) NOT NULL,
    aggregate_id    VARCHAR(64) NOT NULL,
    event_type      VARCHAR(64) NOT NULL,
    payload         JSON NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    next_attempt_at DATETIME NULL,
    attempt_count   INT NOT NULL DEFAULT 0,
    gmt_create      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version         INT NOT NULL DEFAULT 0,
    is_delete       TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_outbox_message_id (message_id),
    INDEX idx_outbox_status_next (status, next_attempt_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
