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

CREATE TABLE IF NOT EXISTS generation_model_capability (
  id                        BIGINT       NOT NULL AUTO_INCREMENT,
  provider_id               VARCHAR(32)  NOT NULL COMMENT 'provider 标识，如 volcengine',
  model_id                  VARCHAR(128) NOT NULL COMMENT '模型 ID，如 doubao-seedream-5-0-lite-250723',
  capability_type           VARCHAR(16)  NOT NULL COMMENT '能力类型：image / video',
  model_label               VARCHAR(64)  NOT NULL COMMENT '前端展示名',
  icon                      VARCHAR(512) DEFAULT NULL COMMENT '模型图标 URL',
  supported_sizes           JSON         NOT NULL COMMENT '支持的尺寸选项 [{id,label,api_value,width,height}]',
  supported_aspect_ratios   JSON         NOT NULL COMMENT '支持的宽高比列表，如 ["1:1","16:9"]',
  supported_formats         JSON         NOT NULL COMMENT '支持的输出格式，如 ["png","jpeg"]；空数组表示不支持自定义',
  default_size              VARCHAR(32)  NOT NULL COMMENT '默认选中的 size_id',
  default_format            VARCHAR(16)  DEFAULT NULL COMMENT '默认输出格式',
  default_aspect_ratio      VARCHAR(16)  NOT NULL COMMENT '默认宽高比',
  features                  JSON         NOT NULL COMMENT '特性开关 {reference_image,watermark,quantity_max,sequential_image_generation,stream,tools}',
  enabled                   TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用',
  gmt_create                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version                   INT          NOT NULL DEFAULT 0 COMMENT '乐观锁',
  is_delete                 TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '逻辑删除',
  PRIMARY KEY (id),
  UNIQUE KEY uk_provider_model (provider_id, model_id),
  KEY idx_capability_type_enabled (capability_type, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模型能力注册表';

-- 火山 Seedream 系列图片生成能力种子数据（MVP，按 png.md 录入）
INSERT INTO generation_model_capability
(provider_id, model_id, capability_type, model_label, icon, supported_sizes, supported_aspect_ratios, supported_formats, default_size, default_format, default_aspect_ratio, features, enabled)
VALUES
('volcengine', 'doubao-seedream-5-0-lite-250723', 'image', 'Seedream 5.0 Lite', NULL,
 '[{"id":"2k","label":"2K","api_value":"2K"},{"id":"3k","label":"3K","api_value":"3K"},{"id":"4k","label":"4K","api_value":"4K"}]',
 '["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]',
 '["png","jpeg"]',
 '2k', 'jpeg', '1:1',
 '{"reference_image":true,"watermark":true,"quantity_max":15,"sequential_image_generation":true,"stream":true,"tools":true}',
 1),
('volcengine', 'doubao-seedream-4-5-251128', 'image', 'Seedream 4.5', NULL,
 '[{"id":"2k","label":"2K","api_value":"2K"},{"id":"4k","label":"4K","api_value":"4K"}]',
 '["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]',
 '[]',
 '2k', NULL, '1:1',
 '{"reference_image":true,"watermark":true,"quantity_max":15,"sequential_image_generation":true,"stream":true,"tools":false}',
 1),
('volcengine', 'doubao-seedream-4-0-250615', 'image', 'Seedream 4.0', NULL,
 '[{"id":"1k","label":"1K","api_value":"1K"},{"id":"2k","label":"2K","api_value":"2K"},{"id":"4k","label":"4K","api_value":"4K"}]',
 '["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]',
 '[]',
 '2k', NULL, '1:1',
 '{"reference_image":true,"watermark":true,"quantity_max":15,"sequential_image_generation":true,"stream":true,"tools":false}',
 1),
('volcengine', 'doubao-seedream-3-0-t2i-250415', 'image', 'Seedream 3.0 T2I', NULL,
 '[{"id":"512x512","label":"512 × 512","api_value":"512x512","width":512,"height":512},{"id":"1024x1024","label":"1024 × 1024","api_value":"1024x1024","width":1024,"height":1024},{"id":"2048x2048","label":"2048 × 2048","api_value":"2048x2048","width":2048,"height":2048}]',
 '["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"]',
 '[]',
 '1024x1024', NULL, '1:1',
 '{"reference_image":false,"watermark":true,"quantity_max":1,"sequential_image_generation":false,"stream":false,"tools":false}',
 1);
