-- ============================================
-- 用户表
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    phone           VARCHAR(20)  NOT NULL,
    username        VARCHAR(50)  NOT NULL,
    status          VARCHAR(30)  NOT NULL DEFAULT 'NORMAL',
    gmt_create      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version         INT          NOT NULL DEFAULT 1,
    is_delete       TINYINT(1)   NOT NULL DEFAULT 0,
    UNIQUE INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 短信验证码表
-- ============================================
CREATE TABLE IF NOT EXISTS verification_codes (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    phone           VARCHAR(20)  NOT NULL,
    code            VARCHAR(6)   NOT NULL,
    ip              VARCHAR(50)  NOT NULL,
    gmt_expire      DATETIME     NOT NULL,
    is_used         TINYINT(1)   NOT NULL DEFAULT 0,
    gmt_create      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_phone_created (phone, gmt_create),
    INDEX idx_phone_unused (phone, is_used, gmt_expire),
    INDEX idx_ip_created (ip, gmt_create)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 图形验证码表
-- ============================================
CREATE TABLE IF NOT EXISTS captcha_challenges (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    token           VARCHAR(36)  NOT NULL,
    answer          VARCHAR(10)  NOT NULL,
    gmt_expire      DATETIME     NOT NULL,
    is_verified     TINYINT(1)   NOT NULL DEFAULT 0,
    gmt_create      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
