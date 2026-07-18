-- ⚠️ 已归档（IK1W1E）：本迁移的变更已并入 V1 基线 (db/migrations/V1__baseline.sql)。
-- 历史保留供追溯，不再由迁移器执行。新增量请放在 db/migrations/V<n>__<slug>.sql。
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
