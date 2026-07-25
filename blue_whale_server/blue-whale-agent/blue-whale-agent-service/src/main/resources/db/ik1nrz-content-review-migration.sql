-- ⚠️ 已归档（IK1W1E）：本迁移的变更已并入 V1 基线 (db/migrations/V1__baseline.sql)。
-- 历史保留供追溯，不再由迁移器执行。新增量请放在 db/migrations/V<n>__<slug>.sql。
-- IK1NRZ 一次性生产迁移：发布内容审核（ContentReview）产品控制面前执行。
-- 示例：mysql --host=<host> --user=<user> --password <database> < ik1nrz-content-review-migration.sql
-- CREATE 语句幂等（IF NOT EXISTS），由迁移台账保证只执行一次。

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
