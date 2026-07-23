-- V17：Creative Skill 版本化库（IK3NPB）
-- 新建稳定身份表 creative_skill + 不可变版本表 creative_skill_version，与旧 skill 表并存：
--   1B 决策——旧 skill 表原封不动，新表自记 source_skill_id 映射回旧表。
-- 身份/版本字段对齐 Creative Skill 激活契约（IK3NHU 已冻结）：
--   creative_skill_id / creative_skill_version_id 正则 ^[a-z][a-z0-9_]{2,79}$
--   content_digest / resource_digest = sha256(body) → "sha256:" + 64 hex（VARCHAR(71)）。
-- 正文 body 存「剥掉 frontmatter 的纯指导内容」，digest 对纯正文算（3A 决策）。
-- seed 回填由 CreativeSkillSeedRunner 启动时执行（2A 决策），本迁移仅建表。

CREATE TABLE creative_skill
(
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    creative_skill_id VARCHAR(80)   NOT NULL,
    name              VARCHAR(255)  NOT NULL,
    description       VARCHAR(1000) NULL,
    source_skill_id   BIGINT        NULL,
    active_version_id VARCHAR(80)   NULL,
    gmt_create        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_creative_skill_id (creative_skill_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'Creative Skill 稳定身份与当前激活版本指针（IK3NPB）';

CREATE TABLE creative_skill_version
(
    id                        BIGINT PRIMARY KEY AUTO_INCREMENT,
    creative_skill_version_id VARCHAR(80)  NOT NULL,
    creative_skill_id         VARCHAR(80)  NOT NULL,
    display_version           VARCHAR(64)  NOT NULL,
    body                      LONGTEXT     NOT NULL,
    content_digest            VARCHAR(71)  NOT NULL,
    resource_digest           VARCHAR(71)  NOT NULL,
    media_type                VARCHAR(128) NOT NULL DEFAULT 'text/markdown',
    gmt_create                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_creative_skill_version_id (creative_skill_version_id),
    UNIQUE KEY uk_creative_skill_version_semver (creative_skill_id, display_version)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'Creative Skill 不可变版本快照（IK3NPB）';
