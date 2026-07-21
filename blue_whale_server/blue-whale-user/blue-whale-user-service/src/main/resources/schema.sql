-- ============================================
-- 用户表
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    phone           VARCHAR(20)  NOT NULL,
    username        VARCHAR(50)  NOT NULL,
    status          VARCHAR(30)  NOT NULL DEFAULT 'NORMAL',
    password        VARCHAR(100) NULL COMMENT 'BCrypt 哈希；NULL=未设密码',
    gmt_create      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version         INT          NOT NULL DEFAULT 1,
    is_delete       TINYINT(1)   NOT NULL DEFAULT 0,
    UNIQUE INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- verification_codes 和 captcha_challenges 已迁移至 Redis，不再建表。

-- password 列幂等迁移（MySQL 8.0.29+ / H2 1.4.200+ 支持 ADD COLUMN IF NOT EXISTS，旧库升级安全）
ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(100) NULL COMMENT 'BCrypt 哈希；NULL=未设密码';
