-- 火山引擎生成能力 MVP 建表脚本。
-- 手动执行：mysql -u<user> -p blue_whale < schema.sql
-- 生产通过迁移工具/DBA 执行，不依赖 spring.sql.init 自动（默认 mode=embedded，MySQL 非嵌入式不自动跑）。
-- 审计字段对齐 BaseEntity：gmt_create / gmt_modified / version / is_delete。

CREATE TABLE IF NOT EXISTS generation_jobs (
  id                BIGINT       NOT NULL AUTO_INCREMENT,
  project_id        BIGINT       DEFAULT NULL COMMENT '项目 id',
  user_id           BIGINT       NOT NULL COMMENT '用户 id（X-User-Id）',
  type              VARCHAR(16)  NOT NULL COMMENT 'image / video',
  source            VARCHAR(16)  NOT NULL DEFAULT 'dock' COMMENT 'dock / agent',
  input             JSON         DEFAULT NULL COMMENT '生成输入参数（prompt/model/resolution 等）',
  status            VARCHAR(16)  NOT NULL DEFAULT 'queued' COMMENT 'queued / processing / succeeded / failed',
  progress          INT          NOT NULL DEFAULT 0 COMMENT '进度 0-100',
  output_asset_ids  JSON         DEFAULT NULL COMMENT '输出 asset id 列表',
  provider          VARCHAR(32)  DEFAULT NULL COMMENT 'volcengine',
  provider_task_id  VARCHAR(128) DEFAULT NULL COMMENT '火山任务 id',
  poll_count        INT          NOT NULL DEFAULT 0,
  next_poll_at      DATETIME     DEFAULT NULL COMMENT '下次轮询时间',
  retry_count       INT          NOT NULL DEFAULT 0,
  last_polled_at    DATETIME     DEFAULT NULL,
  error             JSON         DEFAULT NULL COMMENT '错误信息 {code, message}',
  stage_id          VARCHAR(64)  DEFAULT NULL COMMENT '画布 stage id',
  gmt_create        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version           INT          NOT NULL DEFAULT 0 COMMENT '乐观锁',
  is_delete         TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (id),
  KEY idx_status_next_poll (status, next_poll_at),
  KEY idx_provider_task_id (provider_task_id),
  KEY idx_user_id (user_id),
  KEY idx_project_id (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='生成任务';

CREATE TABLE IF NOT EXISTS assets (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  user_id       BIGINT       NOT NULL,
  type          VARCHAR(16)  NOT NULL COMMENT 'image / video',
  storage_key   VARCHAR(255) DEFAULT NULL COMMENT '存储 key（本地路径或对象存储 key）',
  url           VARCHAR(512) NOT NULL COMMENT '可访问 url',
  mime          VARCHAR(64)  DEFAULT NULL,
  size          BIGINT       DEFAULT NULL COMMENT '字节',
  width         INT          DEFAULT NULL,
  height        INT          DEFAULT NULL,
  duration      INT          DEFAULT NULL COMMENT '视频时长（秒）',
  source        VARCHAR(16)  NOT NULL DEFAULT 'generated' COMMENT 'generated / uploaded',
  status        VARCHAR(16)  NOT NULL DEFAULT 'normal',
  gmt_create    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version       INT          NOT NULL DEFAULT 0,
  is_delete     TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_user_id (user_id),
  KEY idx_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源（图片/视频）';
