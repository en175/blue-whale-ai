-- 迁移版本 V6：Agent 运行状态持久化结构补齐（IK1W1J）
-- 背景：IK1W1E 迁移器对「project 表存在且记账本为空」的旧库只补记 V1、不重放基线 DDL。
-- 早于 Agent 持久化实现的旧库因此被误判为已具备 V1 完整结构，conversations /
-- agent_runs / runtime_checkpoints / run_commits / user_input_requests /
-- conversation_messages / command_idempotency 七张表全部缺失，公开 Conversation
-- 命令因缺表失败（command_idempotency 不存在）。
--
-- 本版本以幂等方式把以下三类已知库形态收敛到当前 Agent 运行持久化契约：
--   1. 空库 / 已具备 V1 完整结构的库：CREATE IF NOT EXISTS 与逐列检查均为 no-op；
--   2. pre-Agent 旧库（无 Agent 表）：建出全部七张表；
--   3. 部分历史 Agent 一次性迁移库（ik10i5 建表、ik10pt 成本确认版
--      user_input_requests）：逐列补齐缺失列、放宽后续契约允许为 NULL 的列、
--      对齐表注释；既有行不删除、不复制、不重置。
-- 收敛完成后做契约断言：七张表的契约列（含类型与可空性）与索引全部存在，
-- 否则迁移失败 fail-closed（未知漂移不得静默标记版本通过）。
--
-- MySQL 8 不支持 ADD COLUMN IF NOT EXISTS，列级收敛统一走
-- information_schema 预检 + 动态 PREPARE，全部语句可重复执行。

-- ===== 1. 幂等建表（与 V1 基线定义一致；表已存在则跳过） =====

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

-- ===== 2. 列级收敛：历史形态缺失列幂等补齐 =====
-- ik10i5 形态缺 agent_runs.confirmed_input_request_id（IK1NRY 引入）。

SET @ddl := (SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_runs'
             AND COLUMN_NAME = 'confirmed_input_request_id'),
    'SELECT 1',
    'ALTER TABLE agent_runs ADD COLUMN confirmed_input_request_id BIGINT NULL AFTER current_checkpoint_id'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ik10i5 形态缺 run_commits.user_input_request_id；generation_job_id 后续契约允许 NULL。

SET @ddl := (SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'run_commits'
             AND COLUMN_NAME = 'user_input_request_id'),
    'SELECT 1',
    'ALTER TABLE run_commits ADD COLUMN user_input_request_id BIGINT NULL AFTER generation_job_id'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (SELECT IF(
    (SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'run_commits'
       AND COLUMN_NAME = 'generation_job_id') = 'NO',
    'ALTER TABLE run_commits MODIFY COLUMN generation_job_id BIGINT NULL',
    'SELECT 1'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ik10i5 形态缺 command_idempotency.generation_job_id；message_id / agent_run_id
-- 后续契约允许 NULL。

SET @ddl := (SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'command_idempotency'
             AND COLUMN_NAME = 'generation_job_id'),
    'SELECT 1',
    'ALTER TABLE command_idempotency ADD COLUMN generation_job_id BIGINT NULL AFTER agent_run_id'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (SELECT IF(
    (SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'command_idempotency'
       AND COLUMN_NAME = 'message_id') = 'NO',
    'ALTER TABLE command_idempotency MODIFY COLUMN message_id BIGINT NULL',
    'SELECT 1'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (SELECT IF(
    (SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'command_idempotency'
       AND COLUMN_NAME = 'agent_run_id') = 'NO',
    'ALTER TABLE command_idempotency MODIFY COLUMN agent_run_id BIGINT NULL',
    'SELECT 1'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ik10pt 成本确认版 user_input_requests 缺 request_type / question /
-- answer_message_id（IK1NRW 泛化引入），六个成本字段后续契约允许 NULL。

SET @ddl := (SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_input_requests'
             AND COLUMN_NAME = 'request_type'),
    'SELECT 1',
    'ALTER TABLE user_input_requests ADD COLUMN request_type VARCHAR(32) NOT NULL DEFAULT ''cost_confirmation'' AFTER user_id'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_input_requests'
             AND COLUMN_NAME = 'question'),
    'SELECT 1',
    'ALTER TABLE user_input_requests ADD COLUMN question TEXT NULL AFTER request_target_type'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (SELECT IF(
    EXISTS(SELECT 1 FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_input_requests'
             AND COLUMN_NAME = 'answer_message_id'),
    'SELECT 1',
    'ALTER TABLE user_input_requests ADD COLUMN answer_message_id BIGINT NULL AFTER consumed_at'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl := (SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_input_requests'
       AND COLUMN_NAME IN ('quoted_amount_fen', 'quoted_provider', 'price_catalog_version',
                           'exchange_rate_version', 'model_policy_version', 'cost_rule_version')
       AND IS_NULLABLE = 'NO') > 0,
    'ALTER TABLE user_input_requests
       MODIFY COLUMN quoted_amount_fen BIGINT NULL,
       MODIFY COLUMN quoted_provider VARCHAR(64) NULL,
       MODIFY COLUMN price_catalog_version VARCHAR(64) NULL,
       MODIFY COLUMN exchange_rate_version VARCHAR(64) NULL,
       MODIFY COLUMN model_policy_version VARCHAR(64) NULL,
       MODIFY COLUMN cost_rule_version VARCHAR(64) NULL',
    'SELECT 1'));
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ===== 3. 表注释收敛（幂等，对齐 V1 契约注释） =====

ALTER TABLE conversations COMMENT = 'Project 唯一 Conversation';
ALTER TABLE agent_runs COMMENT = '持久 AgentRun';
ALTER TABLE runtime_checkpoints COMMENT = 'AgentRun 不透明运行时检查点';
ALTER TABLE run_commits COMMENT = 'AgentRun 提交幂等结果';
ALTER TABLE user_input_requests COMMENT = '产品中性输入请求，归属 AgentRun，区分创作澄清与成本确认';
ALTER TABLE conversation_messages COMMENT = 'Conversation 消息事实';
ALTER TABLE command_idempotency COMMENT = '公开命令幂等接纳记录';

-- ===== 4. 契约断言（fail-closed）：契约列与索引必须全部存在 =====
-- 收敛后逐列/逐索引核对 information_schema，任一缺失即 SIGNAL 失败：
-- 迁移记 failed、容器 exit 非 0，业务服务因就绪门禁不启动。

CREATE TEMPORARY TABLE _v3_expected_columns
(
    table_name  VARCHAR(64) NOT NULL,
    column_name VARCHAR(64) NOT NULL,
    data_type   VARCHAR(32) NOT NULL,
    is_nullable VARCHAR(3)  NOT NULL,
    PRIMARY KEY (table_name, column_name)
);

-- 四元组（表, 列, 类型大类, 可空性）：列缺失、类型漂移或可空性漂移均判未收敛。
INSERT INTO _v3_expected_columns (table_name, column_name, data_type, is_nullable) VALUES
    ('conversations', 'id', 'bigint', 'NO'),
    ('conversations', 'project_id', 'bigint', 'NO'),
    ('conversations', 'gmt_create', 'datetime', 'NO'),
    ('conversations', 'gmt_modified', 'datetime', 'NO'),
    ('conversations', 'version', 'int', 'NO'),
    ('conversations', 'is_delete', 'tinyint', 'NO'),
    ('agent_runs', 'id', 'bigint', 'NO'),
    ('agent_runs', 'project_id', 'bigint', 'NO'),
    ('agent_runs', 'conversation_id', 'bigint', 'NO'),
    ('agent_runs', 'user_id', 'bigint', 'NO'),
    ('agent_runs', 'status', 'varchar', 'NO'),
    ('agent_runs', 'stage', 'varchar', 'YES'),
    ('agent_runs', 'engine', 'varchar', 'NO'),
    ('agent_runs', 'engine_version', 'varchar', 'NO'),
    ('agent_runs', 'adapter_schema_version', 'int', 'NO'),
    ('agent_runs', 'current_checkpoint_id', 'bigint', 'YES'),
    ('agent_runs', 'confirmed_input_request_id', 'bigint', 'YES'),
    ('agent_runs', 'lease_owner', 'varchar', 'YES'),
    ('agent_runs', 'lease_expires_at', 'datetime', 'YES'),
    ('agent_runs', 'fencing_token', 'bigint', 'NO'),
    ('agent_runs', 'gmt_create', 'datetime', 'NO'),
    ('agent_runs', 'gmt_modified', 'datetime', 'NO'),
    ('agent_runs', 'version', 'int', 'NO'),
    ('agent_runs', 'is_delete', 'tinyint', 'NO'),
    ('runtime_checkpoints', 'id', 'bigint', 'NO'),
    ('runtime_checkpoints', 'agent_run_id', 'bigint', 'NO'),
    ('runtime_checkpoints', 'sequence_no', 'int', 'NO'),
    ('runtime_checkpoints', 'run_version', 'int', 'NO'),
    ('runtime_checkpoints', 'engine', 'varchar', 'NO'),
    ('runtime_checkpoints', 'engine_version', 'varchar', 'NO'),
    ('runtime_checkpoints', 'adapter_schema_version', 'int', 'NO'),
    ('runtime_checkpoints', 'payload_digest', 'varchar', 'NO'),
    ('runtime_checkpoints', 'opaque_payload', 'json', 'NO'),
    ('runtime_checkpoints', 'gmt_create', 'datetime', 'NO'),
    ('runtime_checkpoints', 'gmt_modified', 'datetime', 'NO'),
    ('runtime_checkpoints', 'version', 'int', 'NO'),
    ('runtime_checkpoints', 'is_delete', 'tinyint', 'NO'),
    ('run_commits', 'id', 'bigint', 'NO'),
    ('run_commits', 'agent_run_id', 'bigint', 'NO'),
    ('run_commits', 'commit_id', 'varchar', 'NO'),
    ('run_commits', 'request_hash', 'varchar', 'NO'),
    ('run_commits', 'checkpoint_id', 'bigint', 'NO'),
    ('run_commits', 'generation_job_id', 'bigint', 'YES'),
    ('run_commits', 'user_input_request_id', 'bigint', 'YES'),
    ('run_commits', 'committed_cursor', 'bigint', 'NO'),
    ('run_commits', 'gmt_create', 'datetime', 'NO'),
    ('run_commits', 'gmt_modified', 'datetime', 'NO'),
    ('run_commits', 'version', 'int', 'NO'),
    ('run_commits', 'is_delete', 'tinyint', 'NO'),
    ('user_input_requests', 'id', 'bigint', 'NO'),
    ('user_input_requests', 'project_id', 'bigint', 'NO'),
    ('user_input_requests', 'user_id', 'bigint', 'NO'),
    ('user_input_requests', 'request_type', 'varchar', 'NO'),
    ('user_input_requests', 'conversation_id', 'bigint', 'YES'),
    ('user_input_requests', 'source_agent_run_id', 'bigint', 'YES'),
    ('user_input_requests', 'resumed_agent_run_id', 'bigint', 'YES'),
    ('user_input_requests', 'request_target_type', 'varchar', 'YES'),
    ('user_input_requests', 'question', 'text', 'YES'),
    ('user_input_requests', 'action_identity', 'varchar', 'NO'),
    ('user_input_requests', 'action_type', 'varchar', 'NO'),
    ('user_input_requests', 'arguments_digest', 'varchar', 'NO'),
    ('user_input_requests', 'quoted_amount_fen', 'bigint', 'YES'),
    ('user_input_requests', 'quoted_provider', 'varchar', 'YES'),
    ('user_input_requests', 'price_catalog_version', 'varchar', 'YES'),
    ('user_input_requests', 'exchange_rate_version', 'varchar', 'YES'),
    ('user_input_requests', 'model_policy_version', 'varchar', 'YES'),
    ('user_input_requests', 'cost_rule_version', 'varchar', 'YES'),
    ('user_input_requests', 'status', 'varchar', 'NO'),
    ('user_input_requests', 'expires_at', 'datetime', 'NO'),
    ('user_input_requests', 'confirmed_at', 'datetime', 'YES'),
    ('user_input_requests', 'consumed_at', 'datetime', 'YES'),
    ('user_input_requests', 'answer_message_id', 'bigint', 'YES'),
    ('user_input_requests', 'gmt_create', 'datetime', 'NO'),
    ('user_input_requests', 'gmt_modified', 'datetime', 'NO'),
    ('user_input_requests', 'version', 'int', 'NO'),
    ('user_input_requests', 'is_delete', 'tinyint', 'NO'),
    ('conversation_messages', 'id', 'bigint', 'NO'),
    ('conversation_messages', 'conversation_id', 'bigint', 'NO'),
    ('conversation_messages', 'project_id', 'bigint', 'NO'),
    ('conversation_messages', 'agent_run_id', 'bigint', 'YES'),
    ('conversation_messages', 'client_message_id', 'varchar', 'YES'),
    ('conversation_messages', 'role', 'varchar', 'NO'),
    ('conversation_messages', 'content', 'text', 'NO'),
    ('conversation_messages', 'sequence_no', 'int', 'NO'),
    ('conversation_messages', 'gmt_create', 'datetime', 'NO'),
    ('conversation_messages', 'gmt_modified', 'datetime', 'NO'),
    ('conversation_messages', 'version', 'int', 'NO'),
    ('conversation_messages', 'is_delete', 'tinyint', 'NO'),
    ('command_idempotency', 'id', 'bigint', 'NO'),
    ('command_idempotency', 'project_id', 'bigint', 'NO'),
    ('command_idempotency', 'operation', 'varchar', 'NO'),
    ('command_idempotency', 'idempotency_key', 'varchar', 'NO'),
    ('command_idempotency', 'request_hash', 'varchar', 'NO'),
    ('command_idempotency', 'message_id', 'bigint', 'YES'),
    ('command_idempotency', 'agent_run_id', 'bigint', 'YES'),
    ('command_idempotency', 'generation_job_id', 'bigint', 'YES'),
    ('command_idempotency', 'accepted_cursor', 'bigint', 'NO'),
    ('command_idempotency', 'gmt_create', 'datetime', 'NO'),
    ('command_idempotency', 'gmt_modified', 'datetime', 'NO'),
    ('command_idempotency', 'version', 'int', 'NO'),
    ('command_idempotency', 'is_delete', 'tinyint', 'NO');

CREATE TEMPORARY TABLE _v3_expected_indexes
(
    table_name VARCHAR(64) NOT NULL,
    index_name VARCHAR(64) NOT NULL,
    PRIMARY KEY (table_name, index_name)
);

INSERT INTO _v3_expected_indexes (table_name, index_name) VALUES
    ('conversations', 'uk_conversation_project'),
    ('agent_runs', 'idx_agent_run_project_status'),
    ('agent_runs', 'idx_agent_run_claim'),
    ('runtime_checkpoints', 'uk_checkpoint_sequence'),
    ('run_commits', 'uk_run_commit'),
    ('user_input_requests', 'idx_input_request_owner'),
    ('user_input_requests', 'uk_input_request_resumed_run'),
    ('user_input_requests', 'uk_standalone_action_confirmation'),
    ('conversation_messages', 'uk_conversation_sequence'),
    ('conversation_messages', 'idx_message_project'),
    ('command_idempotency', 'uk_command_idempotency');

SET @missing := (
    SELECT GROUP_CONCAT(missing.what SEPARATOR ', ') FROM (
        SELECT CONCAT(e.table_name, '.', e.column_name,
                      IF(c_exist.COLUMN_NAME IS NULL,
                         ' 缺失',
                         CONCAT(' 契约漂移(期望 ', e.data_type, ' ', e.is_nullable, ')'))) AS what
        FROM _v3_expected_columns e
        LEFT JOIN information_schema.COLUMNS c
          ON c.TABLE_SCHEMA = DATABASE()
         AND c.TABLE_NAME = e.table_name
         AND c.COLUMN_NAME = e.column_name
         AND c.DATA_TYPE = e.data_type
         AND c.IS_NULLABLE = e.is_nullable
        LEFT JOIN information_schema.COLUMNS c_exist
          ON c_exist.TABLE_SCHEMA = DATABASE()
         AND c_exist.TABLE_NAME = e.table_name
         AND c_exist.COLUMN_NAME = e.column_name
        WHERE c.COLUMN_NAME IS NULL
        UNION ALL
        SELECT CONCAT(e.table_name, ' 缺索引 ', e.index_name) AS what
        FROM _v3_expected_indexes e
        LEFT JOIN information_schema.STATISTICS s
          ON s.TABLE_SCHEMA = DATABASE()
         AND s.TABLE_NAME = e.table_name
         AND s.INDEX_NAME = e.index_name
        WHERE s.INDEX_NAME IS NULL
    ) missing
);

-- MySQL 8 不允许在 prepared statement 中执行 SIGNAL（ERROR 1295），
-- 因此违规时改为 PREPARE 一段语法非法的文本：PREPARE 本身失败并抛出
-- ERROR 1064，其 near 片段携带违规详情（迁移器将异常记入 V6 failed 并终止）。
SET @assert_sql := IF(@missing IS NULL,
    'SELECT ''V6 Agent 运行持久化契约断言通过'' AS v6_contract',
    CONCAT('V6_CONTRACT_VIOLATION [', SUBSTRING(@missing, 1, 200), ']'));
PREPARE stmt_assert FROM @assert_sql;
EXECUTE stmt_assert;
DEALLOCATE PREPARE stmt_assert;

DROP TEMPORARY TABLE _v3_expected_columns;
DROP TEMPORARY TABLE _v3_expected_indexes;
