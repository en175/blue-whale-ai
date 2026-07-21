-- V10：Runtime Agent Bundle 配置控制面、不可变发布快照与 AgentRun 版本钉住（IK2D8J）

CREATE TABLE runtime_agent_definitions
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    agent_definition_id VARCHAR(80) NOT NULL,
    definition_key VARCHAR(64) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    description VARCHAR(1000) NOT NULL,
    active_bundle_version_id VARCHAR(96) NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_runtime_agent_definition_id (agent_definition_id),
    UNIQUE KEY uk_runtime_agent_definition_key (definition_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'Runtime Agent 稳定身份与当前激活版本指针';

CREATE TABLE runtime_bundle_drafts
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    draft_id VARCHAR(96) NOT NULL,
    agent_definition_id VARCHAR(80) NOT NULL,
    base_version_id VARCHAR(96) NULL,
    draft_revision INT NOT NULL,
    validation_state VARCHAR(16) NOT NULL,
    last_validated_revision INT NULL,
    composition_json JSON NOT NULL,
    resources_json JSON NOT NULL,
    created_by BIGINT NOT NULL,
    updated_by BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_runtime_bundle_draft_id (draft_id),
    UNIQUE KEY uk_runtime_bundle_agent_draft (agent_definition_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '可变 Runtime Bundle 草稿';

CREATE TABLE runtime_bundle_versions
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    bundle_version_id VARCHAR(96) NOT NULL,
    agent_definition_id VARCHAR(80) NOT NULL,
    semantic_version VARCHAR(64) NOT NULL,
    source_draft_id VARCHAR(96) NOT NULL,
    source_draft_revision INT NOT NULL,
    manifest_digest VARCHAR(71) NOT NULL,
    snapshot_json JSON NOT NULL,
    published_by BIGINT NOT NULL,
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_runtime_bundle_version_id (bundle_version_id),
    UNIQUE KEY uk_runtime_bundle_semver (agent_definition_id, semantic_version),
    INDEX idx_runtime_bundle_agent_published (agent_definition_id, published_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '不可变 Runtime Bundle 发布快照';

CREATE TABLE runtime_bundle_resources
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
    metadata_json JSON NOT NULL,
    content MEDIUMTEXT NOT NULL,
    UNIQUE KEY uk_runtime_bundle_resource (bundle_version_id, resource_id),
    INDEX idx_runtime_bundle_resource_digest (bundle_version_id, content_digest)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '按发布版本固化的 Runtime Bundle 资源';

CREATE TABLE runtime_bundle_write_idempotency
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    operation VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(71) NOT NULL,
    response_json JSON NULL,
    actor_user_id BIGINT NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_runtime_bundle_idempotency (operation, idempotency_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'Runtime Bundle 写命令幂等结果';

CREATE TABLE runtime_bundle_audit_records
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    actor_user_id BIGINT NOT NULL,
    operation VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    details_json JSON NOT NULL,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_runtime_bundle_audit_target (target_type, target_id, gmt_create)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'Runtime Bundle 控制面写操作审计';

ALTER TABLE agent_runs
    ADD COLUMN bundle_version_id VARCHAR(96) NULL AFTER adapter_schema_version,
    ADD COLUMN manifest_digest VARCHAR(71) NULL AFTER bundle_version_id,
    ADD COLUMN model_profile_id VARCHAR(80) NULL AFTER manifest_digest,
    ADD COLUMN model_profile_version VARCHAR(64) NULL AFTER model_profile_id,
    ADD COLUMN activated_creative_skill_versions JSON NULL AFTER model_profile_version,
    ADD INDEX idx_agent_run_bundle_version (bundle_version_id);
