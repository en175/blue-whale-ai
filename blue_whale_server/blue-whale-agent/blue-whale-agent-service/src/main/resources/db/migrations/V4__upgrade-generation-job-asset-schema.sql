-- 迁移版本 V3：GenerationJob 与 Asset 持久化结构收敛升级（IK1W1L）
--
-- 背景：IK1W1E 迁移器对旧库（project 表存在且记账本为空）只补记 V1 不重放 DDL，
-- 早于归档一次性迁移（ik10i6/ik10ib/ik10ic/ik10id/ik10if/ik10pt/ik1nrz）的旧库
-- 会缺表、缺列或带旧约束，公开生成与资产查询链路在运行时触发缺表缺列错误。
--
-- 本版本以 V1 基线为权威契约，对 GenerationJob/Asset 域做原地收敛：
--   1. 缺表建表（CREATE TABLE IF NOT EXISTS，定义与 V1 逐字一致）
--   2. 缺列补列（information_schema 预检 + 动态 ALTER，只补受支持历史形态中后加的列）
--   3. 旧约束收敛（generation_job_outputs 三列放宽 NULL，丢弃 ik10ic 时代
--      uk_provider_task_job 旧唯一索引，补齐 ik10id/ik10i6/ik10pt 引入的索引）
--   4. 幂等回填输出槽（复用 ik10id 已验证的回填与状态修正逻辑，重复执行无副作用）
--   5. fail-closed 校验：收敛后全列比对 information_schema，任何无法安全识别的
--      漂移（核心列缺失、列类型或长度不符、可空性不符）以 SIGNAL 明确失败，
--      不记录成功、不允许业务服务将就绪错误推迟到业务请求
--
-- 幂等：全部语句可重复执行，不重复插入、不覆盖、不清空既有 Job/Asset 数据，
-- 不改变既有记录主键、聚合版本、状态与归属。V1/V2 内容与 checksum 保持不变。
--
-- 注意：本文件由 SchemaMigrationService 按分号拆分执行，注释与字符串中
-- 不得出现未配对单引号，语句内分号只允许出现在单引号字符串内部。

-- ============ 1. 缺表建表（定义与 V1 基线一致） ============

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

-- ============ 2. 前置 fail-closed 校验（核心结构） ============
-- 可能以旧形态存在的四张表的初始核心列：任何缺失、类型或长度、可空性不符
-- 都不属于受支持历史形态，在任何 ALTER/回填之前以 SIGNAL 明确失败，
-- 避免把无法安全识别的库改到一半。
-- 可空性期望为 NULL 的列（outputs 三列）在受支持形态间本就不同
-- （ik10i6 为 NOT NULL、ik10ic 起放宽），此处不判定，由第 4 段统一收敛。

SET @drift := (
    SELECT GROUP_CONCAT(CONCAT(e.tbl, '.', e.col, ' 期望 ', e.typ, '/', COALESCE(e.nul, '任意'),
            ' 实际 ', COALESCE(c.DATA_TYPE, '缺失'), '/', COALESCE(c.IS_NULLABLE, '-')) SEPARATOR '; ')
    FROM (
        SELECT 'generation_jobs' AS tbl, 'id' AS col, 'bigint' AS typ, NULL AS len, 'NO' AS nul
        UNION ALL SELECT 'generation_jobs', 'project_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'user_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'agent_run_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'action_identity', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_jobs', 'type', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_jobs', 'source', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_jobs', 'input', 'json', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'status', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_jobs', 'progress', 'int', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'output_asset_ids', 'json', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'provider', 'varchar', 64, 'YES'
        UNION ALL SELECT 'generation_jobs', 'provider_task_id', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_jobs', 'poll_count', 'int', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'next_poll_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'retry_count', 'int', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'last_polled_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'error', 'text', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'stage_id', 'varchar', 64, 'YES'
        UNION ALL SELECT 'generation_jobs', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'assets', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'assets', 'user_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'assets', 'type', 'varchar', 16, 'NO'
        UNION ALL SELECT 'assets', 'storage_key', 'varchar', 512, 'YES'
        UNION ALL SELECT 'assets', 'url', 'varchar', 1024, 'YES'
        UNION ALL SELECT 'assets', 'mime', 'varchar', 128, 'YES'
        UNION ALL SELECT 'assets', 'size', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'assets', 'width', 'int', NULL, 'YES'
        UNION ALL SELECT 'assets', 'height', 'int', NULL, 'YES'
        UNION ALL SELECT 'assets', 'duration', 'int', NULL, 'YES'
        UNION ALL SELECT 'assets', 'source', 'varchar', 32, 'NO'
        UNION ALL SELECT 'assets', 'status', 'varchar', 32, 'NO'
        UNION ALL SELECT 'assets', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'assets', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'assets', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'assets', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'generation_job_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'slot_index', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'asset_id', 'bigint', NULL, NULL
        UNION ALL SELECT 'generation_job_outputs', 'delivery_id', 'varchar', 128, NULL
        UNION ALL SELECT 'generation_job_outputs', 'content_sha256', 'varchar', 64, NULL
        UNION ALL SELECT 'generation_job_outputs', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'generation_job_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'provider', 'varchar', 64, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'account_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'provider_task_id', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'submission_state', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'provider_status', 'varchar', 32, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'callback_capability_digest', 'varchar', 64, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'raw_status', 'varchar', 64, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'raw_error_code', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'raw_error_message', 'text', NULL, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'temporary_result_url', 'varchar', 2048, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'observe_count', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'is_delete', 'tinyint', NULL, 'NO'
    ) e
    LEFT JOIN information_schema.COLUMNS c
        ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = e.tbl AND c.COLUMN_NAME = e.col
    WHERE c.DATA_TYPE IS NULL
       OR c.DATA_TYPE <> e.typ
       OR (e.len IS NOT NULL AND c.CHARACTER_MAXIMUM_LENGTH <> e.len)
       OR (e.nul IS NOT NULL AND c.IS_NULLABLE <> e.nul));
-- SIGNAL 不受 prepared statement 协议支持，改为查询一张以漂移摘要命名的不存在表，
-- 让 MySQL 用 ERROR 1146 抛出含具体漂移列与期望/实际信息的失败。
SET @sig := IF(@drift IS NULL, 'SELECT 1',
    CONCAT('SELECT 1 FROM `v3_拒绝升级_核心结构漂移__',
           LEFT(REPLACE(REPLACE(@drift, ' ', '_'), ';', ','), 40), '`'));
PREPARE stmt FROM @sig;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============ 3. 缺列补列（受支持历史形态中后加的列，缺失才补） ============
-- 受支持形态：ccb35da 初始 generation 域及 ik10i6/ik10ic/ik10id/ik10pt 任一中间态。
-- 只补这些形态里后加的列（全部可空或带默认值，非空表补列安全）。
-- 初始就有的核心列（user_id/type/source/status 等）不在此列，其缺失属未知漂移，
-- 由末尾 fail-closed 校验拒绝。

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='project_action_identity')=0, 'ADD COLUMN project_action_identity VARCHAR(128) NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='expected_output_count')=0, 'ADD COLUMN expected_output_count INT NOT NULL DEFAULT 1', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='retry_of_job_id')=0, 'ADD COLUMN retry_of_job_id BIGINT NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='lease_owner')=0, 'ADD COLUMN lease_owner VARCHAR(128) NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='lease_expires_at')=0, 'ADD COLUMN lease_expires_at DATETIME NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='fencing_token')=0, 'ADD COLUMN fencing_token BIGINT NOT NULL DEFAULT 0', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='strategy_version')=0, 'ADD COLUMN strategy_version VARCHAR(64) NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='execution_deadline_at')=0, 'ADD COLUMN execution_deadline_at DATETIME NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='evidence_reconcile_until')=0, 'ADD COLUMN evidence_reconcile_until DATETIME NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='next_action_at')=0, 'ADD COLUMN next_action_at DATETIME NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND COLUMN_NAME='cancel_requested_at')=0, 'ADD COLUMN cancel_requested_at DATETIME NULL', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE generation_jobs ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='assets' AND COLUMN_NAME='project_id')=0, 'ADD COLUMN project_id BIGINT NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='assets' AND COLUMN_NAME='generation_job_id')=0, 'ADD COLUMN generation_job_id BIGINT NULL', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='assets' AND COLUMN_NAME='content_sha256')=0, 'ADD COLUMN content_sha256 VARCHAR(64) NULL', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE assets ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_job_outputs' AND COLUMN_NAME='status')=0, 'ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT ''pending''', NULL),
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_job_outputs' AND COLUMN_NAME='error')=0, 'ADD COLUMN error JSON NULL', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE generation_job_outputs ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_provider_tasks' AND COLUMN_NAME='slot_index')=0, 'ADD COLUMN slot_index INT NOT NULL DEFAULT 0', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE generation_provider_tasks ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============ 4. 旧约束收敛 ============
-- generation_job_outputs 三列在 ik10i6 形态为 NOT NULL，ik10ic 起放宽为 NULL。
-- 只对仍为 NOT NULL 的旧表执行 MODIFY，重复执行为空操作。
SET @ddl := CONCAT_WS(',',
    IF((SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_job_outputs' AND COLUMN_NAME='asset_id')='NO', 'MODIFY COLUMN asset_id BIGINT NULL', NULL),
    IF((SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_job_outputs' AND COLUMN_NAME='delivery_id')='NO', 'MODIFY COLUMN delivery_id VARCHAR(128) NULL', NULL),
    IF((SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_job_outputs' AND COLUMN_NAME='content_sha256')='NO', 'MODIFY COLUMN content_sha256 VARCHAR(64) NULL', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE generation_job_outputs ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- generation_provider_tasks：ik10ic 形态的唯一索引 uk_provider_task_job（每 job 仅一行）
-- 与多输出契约冲突，存在则丢弃；ik10id 引入的 (generation_job_id, slot_index) 唯一索引缺失则补。

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_provider_tasks' AND INDEX_NAME='uk_provider_task_job')>0, 'DROP INDEX uk_provider_task_job', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_provider_tasks' AND INDEX_NAME='uk_provider_task_job_slot')=0, 'ADD UNIQUE KEY uk_provider_task_job_slot (generation_job_id, slot_index)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_provider_tasks' AND INDEX_NAME='uk_provider_task_ref')=0, 'ADD UNIQUE KEY uk_provider_task_ref (provider, account_id, provider_task_id)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE generation_provider_tasks ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- V1 契约要求的唯一索引，以及 ik10i6/ik10id/ik10ic 为 Worker 认领、缺失重试与
-- 视频 action 扫描引入的辅助索引（V1 快照未并入但属当前运行时契约），缺失则补。
-- 受支持形态下既有数据天然满足唯一约束；若存在冲突数据则本语句失败并
-- fail-closed，属无法安全识别的漂移。

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND INDEX_NAME='uk_agent_run_action')=0, 'ADD UNIQUE KEY uk_agent_run_action (agent_run_id, action_identity)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND INDEX_NAME='uk_project_action_identity')=0, 'ADD UNIQUE KEY uk_project_action_identity (project_id, project_action_identity)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND INDEX_NAME='idx_generation_job_claim')=0, 'ADD INDEX idx_generation_job_claim (source, type, status, lease_expires_at, is_delete, id)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND INDEX_NAME='idx_generation_job_retry_of')=0, 'ADD INDEX idx_generation_job_retry_of (retry_of_job_id)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_jobs' AND INDEX_NAME='idx_generation_video_action')=0, 'ADD INDEX idx_generation_video_action (source, type, status, next_action_at, lease_expires_at, is_delete, id)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE generation_jobs ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='assets' AND INDEX_NAME='idx_asset_project')=0, 'ADD INDEX idx_asset_project (project_id, id)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='assets' AND INDEX_NAME='idx_asset_generation_job')=0, 'ADD INDEX idx_asset_generation_job (generation_job_id)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE assets ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_job_outputs' AND INDEX_NAME='uk_generation_output_slot')=0, 'ADD UNIQUE KEY uk_generation_output_slot (generation_job_id, slot_index)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_job_outputs' AND INDEX_NAME='uk_generation_output_delivery')=0, 'ADD UNIQUE KEY uk_generation_output_delivery (generation_job_id, delivery_id)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE generation_job_outputs ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='asset_storage_objects' AND INDEX_NAME='uk_asset_storage_object_key')=0, 'ADD UNIQUE KEY uk_asset_storage_object_key (storage_key)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='asset_storage_objects' AND INDEX_NAME='idx_asset_storage_gc')=0, 'ADD INDEX idx_asset_storage_gc (state, active_transfer_count, first_unreferenced_at)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE asset_storage_objects ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='asset_object_transfers' AND INDEX_NAME='uk_asset_object_transfer_token')=0, 'ADD UNIQUE KEY uk_asset_object_transfer_token (transfer_token)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='asset_object_transfers' AND INDEX_NAME='idx_asset_transfer_expiry')=0, 'ADD INDEX idx_asset_transfer_expiry (status, expires_at)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE asset_object_transfers ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='generation_result_conflicts' AND INDEX_NAME='idx_generation_result_conflict')=0, 'ADD INDEX idx_generation_result_conflict (generation_job_id, slot_index)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE generation_result_conflicts ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='seedance_callback_inbox' AND INDEX_NAME='uk_seedance_callback_dedup')=0, 'ADD UNIQUE KEY uk_seedance_callback_dedup (dedup_key)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE seedance_callback_inbox ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_reservations' AND INDEX_NAME='uk_cost_reservation_job')=0, 'ADD UNIQUE KEY uk_cost_reservation_job (generation_job_id)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_reservations' AND INDEX_NAME='idx_cost_project_window')=0, 'ADD INDEX idx_cost_project_window (project_id, gmt_create)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_reservations' AND INDEX_NAME='idx_cost_user_window')=0, 'ADD INDEX idx_cost_user_window (user_id, gmt_create)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cost_reservations' AND INDEX_NAME='idx_cost_provider_window')=0, 'ADD INDEX idx_cost_provider_window (provider, gmt_create)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE cost_reservations ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='audit_records' AND INDEX_NAME='idx_audit_correlation')=0, 'ADD INDEX idx_audit_correlation (correlation_id, id)', NULL),
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='audit_records' AND INDEX_NAME='idx_audit_occurred')=0, 'ADD INDEX idx_audit_occurred (occurred_at)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE audit_records ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := CONCAT_WS(',',
    IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='content_reviews' AND INDEX_NAME='uk_content_review_identity')=0, 'ADD UNIQUE KEY uk_content_review_identity (project_id, subject_type, subject_id, content_digest, modality, direction, policy_version)', NULL));
SET @sql := IF(@ddl = '', 'SELECT 1', CONCAT('ALTER TABLE content_reviews ', @ddl));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============ 5. 幂等回填输出槽（复用 ik10id 逻辑） ============
-- 为还没有 slot 0 输出行的既有 Job 回填输出行；已有行不重复插入。
-- 状态修正 UPDATE 重复执行收敛，不改变既有行内容。

INSERT INTO generation_job_outputs
    (generation_job_id, slot_index, asset_id, content_sha256, status, error)
SELECT job.id,
       0,
       asset.id,
       asset.content_sha256,
       CASE
           WHEN asset.id IS NOT NULL OR job.status = 'succeeded' THEN 'succeeded'
           WHEN job.status = 'failed' THEN 'failed'
           ELSE 'pending'
       END,
       CASE
           WHEN job.status = 'failed'
               THEN COALESCE(job.error,
                   JSON_OBJECT('code', 'legacy_failed', 'message', '生成失败'))
           ELSE NULL
       END
FROM generation_jobs job
LEFT JOIN generation_job_outputs existing
    ON existing.generation_job_id = job.id
    AND existing.slot_index = 0
    AND existing.is_delete = 0
LEFT JOIN (
    SELECT generation_job_id, MIN(id) AS asset_id
    FROM assets
    WHERE is_delete = 0
      AND generation_job_id IS NOT NULL
    GROUP BY generation_job_id
) first_asset ON first_asset.generation_job_id = job.id
LEFT JOIN assets asset ON asset.id = first_asset.asset_id
WHERE job.is_delete = 0
  AND existing.id IS NULL;

UPDATE generation_job_outputs
SET status = 'succeeded'
WHERE asset_id IS NOT NULL AND status <> 'succeeded';

UPDATE generation_job_outputs output
JOIN generation_jobs job ON job.id = output.generation_job_id
SET output.status = 'failed',
    output.error = COALESCE(job.error, JSON_OBJECT('code', 'legacy_failed', 'message', '生成失败'))
WHERE output.asset_id IS NULL
  AND job.status = 'failed'
  AND output.status <> 'failed';

-- ============ 6. fail-closed 全列校验 ============
-- 收敛后逐列比对 information_schema：核心列缺失、类型或长度不符、可空性不符
-- 都属于无法安全识别的漂移，以 SIGNAL 明确失败并给出具体列与原因。

SET @drift := (
    SELECT GROUP_CONCAT(CONCAT(e.tbl, '.', e.col, ' 期望 ', e.typ, '/', e.nul,
            ' 实际 ', COALESCE(c.DATA_TYPE, '缺失'), '/', COALESCE(c.IS_NULLABLE, '-')) SEPARATOR '; ')
    FROM (
        SELECT 'generation_jobs' AS tbl, 'id' AS col, 'bigint' AS typ, NULL AS len, 'NO' AS nul
        UNION ALL SELECT 'generation_jobs', 'project_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'user_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'agent_run_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'action_identity', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_jobs', 'project_action_identity', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_jobs', 'expected_output_count', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'retry_of_job_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'type', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_jobs', 'source', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_jobs', 'input', 'json', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'status', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_jobs', 'progress', 'int', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'output_asset_ids', 'json', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'provider', 'varchar', 64, 'YES'
        UNION ALL SELECT 'generation_jobs', 'provider_task_id', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_jobs', 'poll_count', 'int', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'next_poll_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'retry_count', 'int', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'last_polled_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'error', 'text', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'stage_id', 'varchar', 64, 'YES'
        UNION ALL SELECT 'generation_jobs', 'lease_owner', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_jobs', 'lease_expires_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'fencing_token', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'strategy_version', 'varchar', 64, 'YES'
        UNION ALL SELECT 'generation_jobs', 'execution_deadline_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'evidence_reconcile_until', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'next_action_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'cancel_requested_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'generation_jobs', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_jobs', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'generation_job_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'slot_index', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'asset_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'generation_job_outputs', 'delivery_id', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_job_outputs', 'content_sha256', 'varchar', 64, 'YES'
        UNION ALL SELECT 'generation_job_outputs', 'status', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'error', 'json', NULL, 'YES'
        UNION ALL SELECT 'generation_job_outputs', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_job_outputs', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'assets', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'assets', 'project_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'assets', 'user_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'assets', 'generation_job_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'assets', 'type', 'varchar', 16, 'NO'
        UNION ALL SELECT 'assets', 'storage_key', 'varchar', 512, 'YES'
        UNION ALL SELECT 'assets', 'content_sha256', 'varchar', 64, 'YES'
        UNION ALL SELECT 'assets', 'url', 'varchar', 1024, 'YES'
        UNION ALL SELECT 'assets', 'mime', 'varchar', 128, 'YES'
        UNION ALL SELECT 'assets', 'size', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'assets', 'width', 'int', NULL, 'YES'
        UNION ALL SELECT 'assets', 'height', 'int', NULL, 'YES'
        UNION ALL SELECT 'assets', 'duration', 'int', NULL, 'YES'
        UNION ALL SELECT 'assets', 'source', 'varchar', 32, 'NO'
        UNION ALL SELECT 'assets', 'status', 'varchar', 32, 'NO'
        UNION ALL SELECT 'assets', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'assets', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'assets', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'assets', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'storage_key', 'varchar', 512, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'content_sha256', 'varchar', 64, 'YES'
        UNION ALL SELECT 'asset_storage_objects', 'source', 'varchar', 32, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'state', 'varchar', 32, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'active_transfer_count', 'int', NULL, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'first_unreferenced_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'asset_storage_objects', 'delete_owner', 'varchar', 128, 'YES'
        UNION ALL SELECT 'asset_storage_objects', 'delete_lease_expires_at', 'datetime', NULL, 'YES'
        UNION ALL SELECT 'asset_storage_objects', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'asset_storage_objects', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'transfer_token', 'varchar', 64, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'storage_key', 'varchar', 512, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'status', 'varchar', 32, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'expires_at', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'asset_object_transfers', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'generation_job_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'slot_index', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'attempted_delivery_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'expected_content_sha256', 'varchar', 64, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'actual_content_sha256', 'varchar', 64, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'reason', 'varchar', 64, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_result_conflicts', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'generation_job_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'slot_index', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'provider', 'varchar', 64, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'account_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'provider_task_id', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'submission_state', 'varchar', 32, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'provider_status', 'varchar', 32, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'callback_capability_digest', 'varchar', 64, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'raw_status', 'varchar', 64, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'raw_error_code', 'varchar', 128, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'raw_error_message', 'text', NULL, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'temporary_result_url', 'varchar', 2048, 'YES'
        UNION ALL SELECT 'generation_provider_tasks', 'observe_count', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'generation_provider_tasks', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'generation_job_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'provider', 'varchar', 64, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'account_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'provider_task_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'dedup_key', 'varchar', 64, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'payload_hash', 'varchar', 64, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'payload', 'json', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_inbox', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_security_audits', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_security_audits', 'generation_job_id', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'seedance_callback_security_audits', 'account_id', 'varchar', 128, 'YES'
        UNION ALL SELECT 'seedance_callback_security_audits', 'provider_task_id', 'varchar', 128, 'YES'
        UNION ALL SELECT 'seedance_callback_security_audits', 'reason', 'varchar', 64, 'NO'
        UNION ALL SELECT 'seedance_callback_security_audits', 'payload_hash', 'varchar', 64, 'NO'
        UNION ALL SELECT 'seedance_callback_security_audits', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_security_audits', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_security_audits', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'seedance_callback_security_audits', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'cost_budget_locks', 'scope_key', 'varchar', 160, 'NO'
        UNION ALL SELECT 'cost_budget_locks', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'generation_job_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'user_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'project_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'action_identity', 'varchar', 128, 'NO'
        UNION ALL SELECT 'cost_reservations', 'action_type', 'varchar', 64, 'NO'
        UNION ALL SELECT 'cost_reservations', 'provider', 'varchar', 64, 'NO'
        UNION ALL SELECT 'cost_reservations', 'reserved_amount_fen', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'actual_amount_fen', 'bigint', NULL, 'YES'
        UNION ALL SELECT 'cost_reservations', 'status', 'varchar', 32, 'NO'
        UNION ALL SELECT 'cost_reservations', 'price_catalog_version', 'varchar', 64, 'NO'
        UNION ALL SELECT 'cost_reservations', 'exchange_rate_version', 'varchar', 64, 'NO'
        UNION ALL SELECT 'cost_reservations', 'model_policy_version', 'varchar', 64, 'NO'
        UNION ALL SELECT 'cost_reservations', 'cost_rule_version', 'varchar', 64, 'NO'
        UNION ALL SELECT 'cost_reservations', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'cost_reservations', 'is_delete', 'tinyint', NULL, 'NO'
        UNION ALL SELECT 'audit_records', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'audit_records', 'actor_user_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'audit_records', 'project_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'audit_records', 'target_type', 'varchar', 64, 'NO'
        UNION ALL SELECT 'audit_records', 'target_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'audit_records', 'action', 'varchar', 128, 'NO'
        UNION ALL SELECT 'audit_records', 'decision', 'varchar', 32, 'NO'
        UNION ALL SELECT 'audit_records', 'reason_code', 'varchar', 128, 'NO'
        UNION ALL SELECT 'audit_records', 'policy_version', 'varchar', 64, 'NO'
        UNION ALL SELECT 'audit_records', 'price_catalog_version', 'varchar', 64, 'YES'
        UNION ALL SELECT 'audit_records', 'exchange_rate_version', 'varchar', 64, 'YES'
        UNION ALL SELECT 'audit_records', 'model_policy_version', 'varchar', 64, 'YES'
        UNION ALL SELECT 'audit_records', 'cost_rule_version', 'varchar', 64, 'NO'
        UNION ALL SELECT 'audit_records', 'request_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'audit_records', 'correlation_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'audit_records', 'trace_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'audit_records', 'environment', 'varchar', 64, 'NO'
        UNION ALL SELECT 'audit_records', 'occurred_at', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'audit_records', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'content_reviews', 'id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'content_reviews', 'project_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'content_reviews', 'user_id', 'bigint', NULL, 'NO'
        UNION ALL SELECT 'content_reviews', 'subject_type', 'varchar', 32, 'NO'
        UNION ALL SELECT 'content_reviews', 'subject_id', 'varchar', 128, 'NO'
        UNION ALL SELECT 'content_reviews', 'content_digest', 'varchar', 64, 'NO'
        UNION ALL SELECT 'content_reviews', 'modality', 'varchar', 16, 'NO'
        UNION ALL SELECT 'content_reviews', 'direction', 'varchar', 16, 'NO'
        UNION ALL SELECT 'content_reviews', 'policy_version', 'varchar', 64, 'NO'
        UNION ALL SELECT 'content_reviews', 'review_state', 'varchar', 16, 'NO'
        UNION ALL SELECT 'content_reviews', 'decision', 'varchar', 16, 'YES'
        UNION ALL SELECT 'content_reviews', 'failure_code', 'varchar', 32, 'YES'
        UNION ALL SELECT 'content_reviews', 'reason_codes', 'json', NULL, 'YES'
        UNION ALL SELECT 'content_reviews', 'evidence_ref', 'varchar', 256, 'YES'
        UNION ALL SELECT 'content_reviews', 'gmt_create', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'content_reviews', 'gmt_modified', 'datetime', NULL, 'NO'
        UNION ALL SELECT 'content_reviews', 'version', 'int', NULL, 'NO'
        UNION ALL SELECT 'content_reviews', 'is_delete', 'tinyint', NULL, 'NO'
    ) e
    LEFT JOIN information_schema.COLUMNS c
        ON c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = e.tbl AND c.COLUMN_NAME = e.col
    WHERE c.DATA_TYPE IS NULL
       OR c.DATA_TYPE <> e.typ
       OR (e.len IS NOT NULL AND c.CHARACTER_MAXIMUM_LENGTH <> e.len)
       OR c.IS_NULLABLE <> e.nul);
-- 同前置校验：SIGNAL 不受 prepared statement 协议支持，用不存在表名携带漂移摘要报错。
SET @sig := IF(@drift IS NULL, 'SELECT 1',
    CONCAT('SELECT 1 FROM `v3_拒绝升级_收敛后结构不符__',
           LEFT(REPLACE(REPLACE(@drift, ' ', '_'), ';', ','), 40), '`'));
PREPARE stmt FROM @sig;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
