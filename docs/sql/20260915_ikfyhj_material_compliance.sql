-- IKFYHJ：素材校验状态镜像 + 网关执行凭证。见 docs/adr/0087-material-compliance-status-mirror-and-generation-gate.md。
-- 快照日期：2026-09-15。历史快照，与 prisma/migrations/20260915170000_ikfyhj_material_compliance 同源。
CREATE TABLE `material_asset_status` (
  `id`                BIGINT NOT NULL AUTO_INCREMENT,
  `material_id`       VARCHAR(128) NOT NULL COMMENT '上游素材ID（asset-...）',
  `user_id`           BIGINT NOT NULL COMMENT '归属用户（new-api 用户 id）',
  `material_group_id` VARCHAR(128) NOT NULL COMMENT '上游组ID（group-...）',
  `status`            VARCHAR(16) NOT NULL COMMENT 'Processing | Active | Failed',
  `error_code`        VARCHAR(128) NULL COMMENT '上游 Error.Code 原文（仅供内部归因，不展示）',
  `error_message`     VARCHAR(512) NULL COMMENT '上游 Error.Message 原文（仅供内部归因，不展示）',
  `status_checked_at` DATETIME(0) NULL COMMENT '最后一次向上游确认状态的时间',
  `gmt_create`        DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `gmt_modified`      DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `version`           INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_material_asset_status_material` (`material_id`),
  KEY `idx_material_asset_status_poll` (`status`, `gmt_create`),
  KEY `idx_material_asset_status_group` (`material_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `user_info` (
  `id`                  BIGINT NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT NOT NULL COMMENT 'new-api 用户 id（AuthenticatedUser.userId）',
  `provider_credential` VARCHAR(128) NOT NULL COMMENT '上游执行凭证（sk-），明文',
  `gmt_create`          DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `gmt_modified`        DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `version`             INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_info_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
