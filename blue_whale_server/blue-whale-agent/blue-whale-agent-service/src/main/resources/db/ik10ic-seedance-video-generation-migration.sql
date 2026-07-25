-- ⚠️ 已归档（IK1W1E）：本迁移的变更已并入 V1 基线 (db/migrations/V1__baseline.sql)。
-- 历史保留供追溯，不再由迁移器执行。新增量请放在 db/migrations/V<n>__<slug>.sql。
-- IK10IC 一次性生产迁移：在发布 Seedance 视频 Worker 前执行。
ALTER TABLE generation_jobs
    ADD COLUMN strategy_version VARCHAR(64) NULL AFTER fencing_token,
    ADD COLUMN execution_deadline_at DATETIME NULL AFTER strategy_version,
    ADD COLUMN evidence_reconcile_until DATETIME NULL AFTER execution_deadline_at,
    ADD COLUMN next_action_at DATETIME NULL AFTER evidence_reconcile_until,
    ADD COLUMN cancel_requested_at DATETIME NULL AFTER next_action_at,
    ADD INDEX idx_generation_video_action
        (source, type, status, next_action_at, lease_expires_at, is_delete, id);

ALTER TABLE generation_job_outputs
    MODIFY COLUMN asset_id BIGINT NULL,
    MODIFY COLUMN delivery_id VARCHAR(128) NULL,
    MODIFY COLUMN content_sha256 VARCHAR(64) NULL;

CREATE TABLE IF NOT EXISTS generation_provider_tasks
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
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
    UNIQUE KEY uk_provider_task_job (generation_job_id),
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
