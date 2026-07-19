-- 迁移版本 V7：生成模型能力注册表建表与 Seedream 种子（IK21O4）
-- 背景：generation_model_capability 表此前只有 JPA entity，全仓无 DDL 无种子，
-- GET /api/generation/models 端点虽已存在但因表缺失无法返回任何模型能力，
-- BottomDock 与生成流页因此无法从后端发现可用模型。
-- 本版本幂等建表并种子一行 enabled 的 doubao-seedream-5.0-lite，
-- 即火山方舟 Agent Plan 唯一文生图模型，为父工单 IK21O3 真实接入铺地基。
--
-- JSON 列（supported_sizes / supported_aspect_ratios / supported_formats / features）
-- 由 JacksonTypeHandler 配合全局 SNAKE_CASE ObjectMapper 整存整取，
-- 种子 JSON 字段一律 snake_case 与 entity camelCase 对齐。
-- 收敛后做契约断言：表与种子行必须就位，否则迁移失败 fail-closed，
-- 迁移器将异常记入 V7 failed 并终止，业务服务因就绪门禁不启动。

-- ===== 1. 幂等建表（与 GenerationModelCapability entity 契约一致；表已存在则跳过） =====

CREATE TABLE IF NOT EXISTS generation_model_capability
(
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    provider_id VARCHAR(64) NOT NULL,
    model_id VARCHAR(128) NOT NULL,
    capability_type VARCHAR(32) NOT NULL,
    model_label VARCHAR(128) NULL,
    icon VARCHAR(512) NULL,
    supported_sizes JSON NULL,
    supported_aspect_ratios JSON NULL,
    supported_formats JSON NULL,
    default_size VARCHAR(32) NULL,
    default_format VARCHAR(32) NULL,
    default_aspect_ratio VARCHAR(32) NULL,
    features JSON NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    gmt_create DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    gmt_modified DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    version INT NOT NULL DEFAULT 0,
    is_delete TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY uk_gmc_provider_model (provider_id, model_id),
    INDEX idx_gmc_capability_enabled (capability_type, enabled, is_delete)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT ='生成模型能力注册表';

-- ===== 2. 种子：火山方舟 Seedream 5.0 lite（Agent Plan 唯一文生图模型） =====
-- 尺寸档位 2K/3K/4K 对应 Ark API size 参数取值，宽高比自适应（官方范围 1/16 到 16，
-- 种子列前端常见预设档），输出格式 png/jpeg，组图 sequential_image_generation、
-- 流式 stream、联网搜索 tools 全开，单次数量上限 4。INSERT IGNORE 靠
-- uk_gmc_provider_model 幂等去重，重跑安全。

INSERT IGNORE INTO generation_model_capability
    (provider_id, model_id, capability_type, model_label, icon,
     supported_sizes, supported_aspect_ratios, supported_formats,
     default_size, default_format, default_aspect_ratio,
     features, enabled)
VALUES (
    'volcengine',
    'doubao-seedream-5.0-lite',
    'image',
    '豆包 Seedream 5.0 lite',
    NULL,
    JSON_ARRAY(
        JSON_OBJECT('id', '2k', 'label', '2K', 'api_value', '2K', 'width', 2048, 'height', 2048),
        JSON_OBJECT('id', '3k', 'label', '3K', 'api_value', '3K', 'width', 3072, 'height', 3072),
        JSON_OBJECT('id', '4k', 'label', '4K', 'api_value', '4K', 'width', 4096, 'height', 4096)
    ),
    JSON_ARRAY('1:1', '16:9', '9:16', '4:3', '3:4', '21:9'),
    JSON_ARRAY('png', 'jpeg'),
    '2K',
    'png',
    '1:1',
    JSON_OBJECT(
        'reference_image', TRUE,
        'watermark', TRUE,
        'quantity_max', 4,
        'sequential_image_generation', TRUE,
        'stream', TRUE,
        'tools', TRUE
    ),
    1
);

-- ===== 3. 契约断言（fail-closed）：表与 enabled 种子行必须就位 =====
-- 建表与种子执行后逐项核对 information_schema 与种子行，任一缺失即抛错：
-- MySQL 8 不允许在 prepared statement 中执行 SIGNAL（ERROR 1295），
-- 改为 PREPARE 一段语法非法文本，PREPARE 本身失败抛 ERROR 1064，
-- 其 near 片段携带违规详情（迁移器将异常记入 V7 failed 并终止）。

SET @missing := (
    SELECT GROUP_CONCAT(missing.what SEPARATOR ', ') FROM (
        (SELECT '缺表 generation_model_capability' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'generation_model_capability'
         ))
        UNION ALL
        (SELECT '缺 enabled 种子行 volcengine/doubao-seedream-5.0-lite' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM generation_model_capability
             WHERE provider_id = 'volcengine'
               AND model_id = 'doubao-seedream-5.0-lite'
               AND capability_type = 'image'
               AND enabled = 1
               AND is_delete = 0
         ))
    ) missing
);

SET @assert_sql := IF(@missing IS NULL,
    'SELECT ''V7 模型能力表与 Seedream 种子就绪'' AS v7_contract',
    CONCAT('V7_CONTRACT_VIOLATION [', SUBSTRING(@missing, 1, 200), ']'));
PREPARE stmt_assert FROM @assert_sql;
EXECUTE stmt_assert;
DEALLOCATE PREPARE stmt_assert;
