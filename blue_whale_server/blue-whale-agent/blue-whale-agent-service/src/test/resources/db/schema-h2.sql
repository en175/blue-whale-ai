-- H2（MODE=MySQL）集成测试建表脚本。
-- 与迁移链最终 schema 对齐（V1 基线 + V3 游标列改名 event_cursor + V7 能力注册表 + V8 收件箱 + V9 Assistant 分块 + V10 Runtime Bundle），但去掉 MySQL 专有语法（ENGINE/CHARSET/COMMENT/JSON→CLOB/ON UPDATE）。
-- 通用 IT schema（test profile 全量 IT 共用），生产以 db/migrations 迁移链为准。

CREATE TABLE IF NOT EXISTS project
(
    id           BIGINT PRIMARY KEY AUTO_INCREMENT,
    owner_id     BIGINT       NOT NULL,
    name         VARCHAR(128) NOT NULL,
    thumb        VARCHAR(512) NULL,
    purpose      VARCHAR(32)  NOT NULL DEFAULT 'canvas',
    gmt_create   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version      INT          NOT NULL DEFAULT 0,
    is_delete    TINYINT      NOT NULL DEFAULT 0,
    inbox_guard  BIGINT GENERATED ALWAYS AS (CASE WHEN purpose = 'generation_inbox' AND is_delete = 0 THEN owner_id ELSE NULL END),
    CONSTRAINT uk_project_inbox_guard UNIQUE (inbox_guard)
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
    is_delete TINYINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversation_project ON conversations (project_id);

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
    bundle_version_id VARCHAR(96) NULL,
    manifest_digest VARCHAR(71) NULL,
    model_profile_id VARCHAR(80) NULL,
    model_profile_version VARCHAR(64) NULL,
    activated_creative_skill_versions CLOB NULL,
    tool_grants CLOB NULL,
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

CREATE TABLE IF NOT EXISTS runtime_agent_definitions
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    agent_definition_id VARCHAR(80) NOT NULL,
    definition_key VARCHAR(64) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    description VARCHAR(1000) NOT NULL,
    active_bundle_version_id VARCHAR(96) NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_runtime_agent_definition_id UNIQUE (agent_definition_id),
    CONSTRAINT uk_runtime_agent_definition_key UNIQUE (definition_key)
);

CREATE TABLE IF NOT EXISTS runtime_bundle_drafts
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    draft_id VARCHAR(96) NOT NULL,
    agent_definition_id VARCHAR(80) NOT NULL,
    base_version_id VARCHAR(96) NULL,
    draft_revision INT NOT NULL,
    validation_state VARCHAR(16) NOT NULL,
    last_validated_revision INT NULL,
    composition_json CLOB NOT NULL,
    resources_json CLOB NOT NULL,
    created_by BIGINT NOT NULL,
    updated_by BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_runtime_bundle_draft_id UNIQUE (draft_id),
    CONSTRAINT uk_runtime_bundle_agent_draft UNIQUE (agent_definition_id)
);

CREATE TABLE IF NOT EXISTS runtime_bundle_versions
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    bundle_version_id VARCHAR(96) NOT NULL,
    agent_definition_id VARCHAR(80) NOT NULL,
    semantic_version VARCHAR(64) NOT NULL,
    source_draft_id VARCHAR(96) NOT NULL,
    source_draft_revision INT NOT NULL,
    manifest_digest VARCHAR(71) NOT NULL,
    snapshot_json CLOB NOT NULL,
    published_by BIGINT NOT NULL,
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_runtime_bundle_version_id UNIQUE (bundle_version_id),
    CONSTRAINT uk_runtime_bundle_semver UNIQUE (agent_definition_id, semantic_version)
);

CREATE TABLE IF NOT EXISTS runtime_bundle_resources
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    bundle_version_id VARCHAR(96) NOT NULL,
    resource_id VARCHAR(80) NOT NULL,
    resource_revision INT NOT NULL,
    resource_kind VARCHAR(32) NOT NULL,
    resource_path VARCHAR(512) NOT NULL,
    media_type VARCHAR(128) NOT NULL,
    load_mode VARCHAR(16) NOT NULL,
    content_digest VARCHAR(71) NOT NULL,
    size_bytes BIGINT NOT NULL,
    token_estimate INT NOT NULL,
    metadata_json CLOB NOT NULL,
    content CLOB NOT NULL,
    CONSTRAINT uk_runtime_bundle_resource UNIQUE (bundle_version_id, resource_id)
);

CREATE TABLE IF NOT EXISTS runtime_bundle_write_idempotency
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    operation VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(71) NOT NULL,
    response_json CLOB NULL,
    actor_user_id BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_runtime_bundle_idempotency UNIQUE (operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS runtime_bundle_audit_records
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    actor_user_id BIGINT NOT NULL,
    operation VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    details_json CLOB NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    stream_id VARCHAR(128) NULL,
    role VARCHAR(16) NOT NULL,
    content CLOB NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'completed',
    last_chunk_sequence INT NOT NULL DEFAULT 0,
    sequence_no INT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_conversation_sequence UNIQUE (conversation_id, sequence_no),
    CONSTRAINT uk_conversation_stream UNIQUE (stream_id)
);

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
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_assistant_stream_id UNIQUE (stream_id),
    CONSTRAINT uk_assistant_stream_run UNIQUE (agent_run_id)
);

CREATE TABLE IF NOT EXISTS assistant_message_chunks
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    assistant_message_stream_id BIGINT NOT NULL,
    sequence_no INT NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    content CLOB NOT NULL,
    content_digest VARCHAR(64) NOT NULL,
    released TINYINT NOT NULL DEFAULT 0,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_assistant_chunk_sequence UNIQUE (assistant_message_stream_id, sequence_no),
    CONSTRAINT uk_assistant_chunk_idempotency UNIQUE (assistant_message_stream_id, idempotency_key)
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
    resource_id BIGINT NULL,
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
    source_asset_id   BIGINT NULL,
    gmt_create        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version           INT      NOT NULL DEFAULT 0,
    is_delete         TINYINT  NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_asset_source_asset ON assets (source_asset_id);

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

-- 生成模型能力注册表（V7 对齐；JSON 列退化为 CLOB，JacksonTypeHandler 整存整取）。
-- 种子与 V7 一致：火山方舟 Agent Plan 唯一文生图模型 doubao-seedream-5.0-lite。
-- Agent action 落 GenerationJob 时按本表注入默认 model_id、校验 size 白名单，
-- 缺表/缺种子时注入 fail-closed 拒绝 action（IK21O7 回归补齐）。
CREATE TABLE IF NOT EXISTS generation_model_capability
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    provider_id VARCHAR(64) NOT NULL,
    model_id VARCHAR(128) NOT NULL,
    capability_type VARCHAR(32) NOT NULL,
    model_label VARCHAR(128) NULL,
    icon VARCHAR(512) NULL,
    supported_sizes CLOB NULL,
    supported_aspect_ratios CLOB NULL,
    supported_formats CLOB NULL,
    default_size VARCHAR(32) NULL,
    default_format VARCHAR(32) NULL,
    default_aspect_ratio VARCHAR(32) NULL,
    features CLOB NULL,
    enabled TINYINT NOT NULL DEFAULT 0,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_gmc_provider_model UNIQUE (provider_id, model_id)
);

INSERT INTO generation_model_capability
    (provider_id, model_id, capability_type, model_label, icon,
     supported_sizes, supported_aspect_ratios, supported_formats,
     default_size, default_format, default_aspect_ratio,
     features, enabled)
SELECT 'volcengine',
    'doubao-seedream-5.0-lite',
    'image',
    '豆包 Seedream 5.0 lite',
    NULL,
    '[{"id":"2k","label":"2K","api_value":"2K","width":2048,"height":2048},'
        || '{"id":"3k","label":"3K","api_value":"3K","width":3072,"height":3072},'
        || '{"id":"4k","label":"4K","api_value":"4K","width":4096,"height":4096}]',
    '["1:1","16:9","9:16","4:3","3:4","21:9"]',
    '["png","jpeg"]',
    '2K',
    'png',
    '1:1',
    '{"reference_image":true,"watermark":true,"quantity_max":4,'
        || '"sequential_image_generation":true,"stream":true,"tools":true}',
    1
WHERE NOT EXISTS (
    SELECT 1 FROM generation_model_capability
    WHERE provider_id = 'volcengine' AND model_id = 'doubao-seedream-5.0-lite'
);
