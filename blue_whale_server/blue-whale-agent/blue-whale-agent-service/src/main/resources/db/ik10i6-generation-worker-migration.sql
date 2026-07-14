-- IK10I6 一次性生产迁移：在发布 Generation Worker 前执行。
-- 示例：mysql --host=<host> --user=<user> --password <database> < ik10i6-generation-worker-migration.sql
-- ALTER 语句由迁移台账保证只执行一次。

ALTER TABLE generation_jobs
    ADD COLUMN lease_owner VARCHAR(128) NULL COMMENT '当前 Worker 身份' AFTER stage_id,
    ADD COLUMN lease_expires_at DATETIME NULL COMMENT '租约失效时间' AFTER lease_owner,
    ADD COLUMN fencing_token BIGINT NOT NULL DEFAULT 0 COMMENT '单调递增执行围栏' AFTER lease_expires_at,
    ADD INDEX idx_generation_job_claim (source, type, status, lease_expires_at, is_delete, id);

ALTER TABLE assets
    -- 为兼容既有 BottomDock/上传 Asset 先保持可空；本票新建的 Agent Asset 在接纳事务中强制写入 Project。
    ADD COLUMN project_id BIGINT NULL COMMENT '所属 Project' AFTER id,
    ADD COLUMN generation_job_id BIGINT NULL COMMENT '来源 GenerationJob' AFTER user_id,
    ADD COLUMN content_sha256 VARCHAR(64) NULL COMMENT '不可变内容摘要' AFTER storage_key,
    ADD INDEX idx_asset_project (project_id, id),
    ADD INDEX idx_asset_generation_job (generation_job_id);

CREATE TABLE IF NOT EXISTS generation_job_outputs
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    generation_job_id BIGINT NOT NULL,
    slot_index INT NOT NULL,
    asset_id BIGINT NOT NULL,
    delivery_id VARCHAR(128) NOT NULL,
    content_sha256 VARCHAR(64) NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_generation_output_slot (generation_job_id, slot_index),
    UNIQUE KEY uk_generation_output_delivery (generation_job_id, delivery_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='GenerationJob 输出槽事实';

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
