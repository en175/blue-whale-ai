-- 025_ikfyhj_material_compliance：schema 基线片段。
SET NAMES utf8mb4;

-- IKFYHJ：素材校验状态镜像 + 网关执行凭证。见 docs/adr/0087-material-compliance-status-mirror-and-generation-gate.md。
-- 与 prisma/migrations/20260915170000_ikfyhj_material_compliance/migration.sql 双轨同步。

-- 素材校验状态：镜像上游素材状态，作为生成任务「该素材能否用作视频生成参考」的判据。
-- status：Processing | Active | Failed。素材真身在上游，本表只存状态与失败原文。
-- 无 is_delete/deleted_at：本表行是素材的附属状态，没有独立价值，删除时硬删（ADR-0087 决策 5）。
CREATE TABLE `material_assets` (
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
  UNIQUE KEY `uk_material_assets_material` (`material_id`),
  KEY `idx_material_assets_poll` (`status`, `gmt_create`),
  KEY `idx_material_assets_group` (`material_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 网关侧执行凭证：定时兜底需要以「素材归属用户」的身份代打网关（网关无服务级查询入口）。
-- 明文存储，对齐 backend/libs/shared/generation/credential.ts「修正四：去密封，明文存 job.input.provider_credential」。
-- 登录成功时写入（auth.controller.ts 的 establishSession）；管理员轮换后旧值失效，下次登录自愈。
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
