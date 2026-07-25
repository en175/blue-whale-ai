-- ⚠️ 已归档（IK1W1E）：本迁移的变更已并入 V1 基线 (db/migrations/V1__baseline.sql)。
-- 历史保留供追溯，不再由迁移器执行。新增量请放在 db/migrations/V<n>__<slug>.sql。
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

ALTER TABLE agent_runs
    ADD COLUMN confirmed_input_request_id BIGINT NULL AFTER current_checkpoint_id;

ALTER TABLE run_commits
    ADD COLUMN user_input_request_id BIGINT NULL AFTER generation_job_id;

ALTER TABLE generation_jobs
    ADD COLUMN project_action_identity VARCHAR(128) NULL AFTER action_identity,
    ADD UNIQUE KEY uk_project_action_identity (project_id, project_action_identity);

CREATE TABLE IF NOT EXISTS user_input_requests
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    conversation_id BIGINT NULL,
    source_agent_run_id BIGINT NULL,
    resumed_agent_run_id BIGINT NULL,
    request_target_type VARCHAR(64) NULL,
    action_identity VARCHAR(128) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    arguments_digest VARCHAR(64) NOT NULL,
    quoted_amount_fen BIGINT NOT NULL,
    quoted_provider VARCHAR(64) NOT NULL,
    price_catalog_version VARCHAR(64) NOT NULL,
    exchange_rate_version VARCHAR(64) NOT NULL,
    model_policy_version VARCHAR(64) NOT NULL,
    cost_rule_version VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    expires_at DATETIME NOT NULL,
    confirmed_at DATETIME NULL,
    consumed_at DATETIME NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_input_request_resumed_run (resumed_agent_run_id),
    UNIQUE KEY uk_standalone_action_confirmation (
        project_id, user_id, request_target_type, action_identity),
    KEY idx_input_request_owner (project_id, user_id, status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
