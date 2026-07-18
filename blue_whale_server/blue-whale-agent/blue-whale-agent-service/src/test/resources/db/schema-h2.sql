-- H2（MODE=MySQL）集成测试建表脚本。
-- 与迁移链最终 schema 对齐（V1 基线 + V3 游标列改名 event_cursor），但去掉 MySQL 专有语法（ENGINE/CHARSET/COMMENT/JSON→CLOB/ON UPDATE）。
-- 仅用于 SnapshotSseRecoveryIT，生产以 db/migrations 迁移链为准。

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
    confirmed_input_request_id BIGINT NULL,
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
    generation_job_id BIGINT NULL,
    user_input_request_id BIGINT NULL,
    committed_cursor BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_run_commit UNIQUE (agent_run_id, commit_id)
);

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
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_input_request_resumed_run UNIQUE (resumed_agent_run_id),
    CONSTRAINT uk_standalone_action_confirmation UNIQUE (
        project_id, user_id, request_target_type, action_identity)
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
    message_id BIGINT NULL,
    agent_run_id BIGINT NULL,
    generation_job_id BIGINT NULL,
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
    project_action_identity VARCHAR(128) NULL,
    expected_output_count INT NOT NULL DEFAULT 1,
    retry_of_job_id  BIGINT NULL,
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
    lease_owner      VARCHAR(128) NULL,
    lease_expires_at DATETIME NULL,
    fencing_token    BIGINT NOT NULL DEFAULT 0,
    strategy_version VARCHAR(64) NULL,
    execution_deadline_at DATETIME NULL,
    evidence_reconcile_until DATETIME NULL,
    next_action_at DATETIME NULL,
    cancel_requested_at DATETIME NULL,
    gmt_create       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version          INT      NOT NULL DEFAULT 0,
    is_delete        TINYINT  NOT NULL DEFAULT 0,
    CONSTRAINT uk_agent_run_action UNIQUE (agent_run_id, action_identity),
    CONSTRAINT uk_project_action_identity UNIQUE (project_id, project_action_identity)
);

CREATE TABLE IF NOT EXISTS assets
(
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id        BIGINT NULL,
    user_id           BIGINT       NOT NULL,
    generation_job_id BIGINT NULL,
    type              VARCHAR(16)  NOT NULL,
    storage_key       VARCHAR(512) NULL,
    content_sha256    VARCHAR(64) NULL,
    url               VARCHAR(1024) NULL,
    mime              VARCHAR(128) NULL,
    size              BIGINT NULL,
    width             INT NULL,
    height            INT NULL,
    duration          INT NULL,
    source            VARCHAR(32)  NOT NULL,
    status            VARCHAR(32)  NOT NULL,
    gmt_create        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version           INT      NOT NULL DEFAULT 0,
    is_delete         TINYINT  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS generation_job_outputs
(
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
    slot_index        INT NOT NULL,
    asset_id          BIGINT NULL,
    delivery_id       VARCHAR(128) NULL,
    content_sha256    VARCHAR(64) NULL,
    status            VARCHAR(32) NOT NULL DEFAULT 'pending',
    error             CLOB NULL,
    gmt_create        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version           INT NOT NULL DEFAULT 0,
    is_delete         TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_generation_output_slot UNIQUE (generation_job_id, slot_index),
    CONSTRAINT uk_generation_output_delivery UNIQUE (generation_job_id, delivery_id)
);

CREATE TABLE IF NOT EXISTS asset_storage_objects
(
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT,
    storage_key             VARCHAR(512) NOT NULL,
    content_sha256          VARCHAR(64) NULL,
    source                  VARCHAR(32) NOT NULL,
    state                   VARCHAR(32) NOT NULL,
    active_transfer_count   INT NOT NULL DEFAULT 0,
    first_unreferenced_at   DATETIME NULL,
    delete_owner            VARCHAR(128) NULL,
    delete_lease_expires_at DATETIME NULL,
    gmt_create              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version                 INT NOT NULL DEFAULT 0,
    is_delete               TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_asset_storage_object_key UNIQUE (storage_key)
);

CREATE TABLE IF NOT EXISTS asset_object_transfers
(
    id            BIGINT PRIMARY KEY AUTO_INCREMENT,
    transfer_token VARCHAR(64) NOT NULL,
    storage_key   VARCHAR(512) NOT NULL,
    status        VARCHAR(32) NOT NULL,
    expires_at    DATETIME NOT NULL,
    gmt_create    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version       INT NOT NULL DEFAULT 0,
    is_delete     TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_asset_object_transfer_token UNIQUE (transfer_token)
);

CREATE TABLE IF NOT EXISTS generation_result_conflicts
(
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id       BIGINT NOT NULL,
    slot_index              INT NOT NULL,
    attempted_delivery_id   VARCHAR(128) NOT NULL,
    expected_content_sha256 VARCHAR(64) NOT NULL,
    actual_content_sha256   VARCHAR(64) NOT NULL,
    reason                  VARCHAR(64) NOT NULL,
    gmt_create              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version                 INT NOT NULL DEFAULT 0,
    is_delete               TINYINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS generation_provider_tasks
(
    id                         BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id          BIGINT NOT NULL,
    slot_index                 INT NOT NULL,
    provider                   VARCHAR(64) NOT NULL,
    account_id                 VARCHAR(128) NOT NULL,
    provider_task_id           VARCHAR(128) NULL,
    submission_state           VARCHAR(32) NOT NULL,
    provider_status            VARCHAR(32) NULL,
    callback_capability_digest VARCHAR(64) NOT NULL,
    raw_status                 VARCHAR(64) NULL,
    raw_error_code             VARCHAR(128) NULL,
    raw_error_message          CLOB NULL,
    temporary_result_url       VARCHAR(2048) NULL,
    observe_count              INT NOT NULL DEFAULT 0,
    gmt_create                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version                    INT NOT NULL DEFAULT 0,
    is_delete                  TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_provider_task_job_slot UNIQUE (generation_job_id, slot_index),
    CONSTRAINT uk_provider_task_ref UNIQUE (provider, account_id, provider_task_id)
);

CREATE TABLE IF NOT EXISTS seedance_callback_inbox
(
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id   BIGINT NOT NULL,
    provider             VARCHAR(64) NOT NULL,
    account_id           VARCHAR(128) NOT NULL,
    provider_task_id     VARCHAR(128) NOT NULL,
    dedup_key            VARCHAR(64) NOT NULL,
    payload_hash         VARCHAR(64) NOT NULL,
    payload              CLOB NOT NULL,
    gmt_create           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version              INT NOT NULL DEFAULT 0,
    is_delete            TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_seedance_callback_dedup UNIQUE (dedup_key)
);

CREATE TABLE IF NOT EXISTS seedance_callback_security_audits
(
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id   BIGINT NULL,
    account_id           VARCHAR(128) NULL,
    provider_task_id     VARCHAR(128) NULL,
    reason               VARCHAR(64) NOT NULL,
    payload_hash         VARCHAR(64) NOT NULL,
    gmt_create           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version              INT NOT NULL DEFAULT 0,
    is_delete            TINYINT NOT NULL DEFAULT 0
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
    event_cursor      BIGINT       NOT NULL,
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
    CONSTRAINT uk_project_cursor UNIQUE (project_id, event_cursor)
);

CREATE INDEX IF NOT EXISTS idx_project_occurred ON project_events (project_id, occurred_at);

CREATE TABLE IF NOT EXISTS outbox_messages
(
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id      VARCHAR(64)  NOT NULL,
    project_id      BIGINT       NOT NULL,
    event_cursor    BIGINT       NOT NULL,
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
CREATE TABLE IF NOT EXISTS cost_budget_locks
(
    scope_key VARCHAR(160) PRIMARY KEY,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_cost_reservation_job UNIQUE (generation_job_id)
);

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
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    reason_codes CLOB NULL,
    evidence_ref VARCHAR(256) NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_content_review_identity UNIQUE (project_id, subject_type, subject_id, content_digest, modality, direction, policy_version)
);
