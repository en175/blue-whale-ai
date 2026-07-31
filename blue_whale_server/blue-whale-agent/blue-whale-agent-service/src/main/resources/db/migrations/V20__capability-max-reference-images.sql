-- 迁移版本 V20：能力表 features 增加 max_reference_images + 补录 Seedream 5.0 Pro（IK5OWQ）
-- 背景：参考图上限此前由 Provider 硬编码 MAX_REFERENCE_IMAGES=4，不按模型区分；
-- Seedream 5.0 Pro 官方支持最多 10 张参考图，但能力表无该行（线上 reference_image 亦未开启），
-- 前端门控已按 features.reference_image 工作，缺行导致 Pro 用户看不到参考图上传入口。
-- 本版本：
--   1. 为既有 lite 行 features 追加 max_reference_images（=4，与 Provider 历史硬编码一致）
--   2. Upsert Seedream 5.0 Pro 能力行（reference_image=true, max_reference_images=10）
--   3. fail-closed 契约断言：Pro 行就位且字段正确，否则迁移失败。
--
-- JSON 字段 snake_case，与 JacksonTypeHandler 全局 SNAKE_CASE ObjectMapper 对齐。

-- ===== 1. 既有 lite 行追加 max_reference_images =====

UPDATE generation_model_capability
SET features = JSON_SET(features, '$.max_reference_images', 4)
WHERE provider_id = 'volcengine'
  AND model_id = 'doubao-seedream-5.0-lite'
  AND capability_type = 'image'
  AND is_delete = 0
  AND (features IS NULL OR NOT JSON_CONTAINS_PATH(features, 'one', '$.max_reference_images'));

-- ===== 2. Upsert Seedream 5.0 Pro 能力行 =====
-- 尺寸档位与 lite 一致（官方 1K~4K），参考图上限 10，组图/流式/联网搜索全开。
-- INSERT ... ON DUPLICATE KEY UPDATE 靠 uk_gmc_provider_model 幂等。

INSERT INTO generation_model_capability
    (provider_id, model_id, capability_type, model_label, icon,
     supported_sizes, supported_aspect_ratios, supported_formats,
     default_size, default_format, default_aspect_ratio,
     features, enabled)
VALUES (
    'volcengine',
    'doubao-seedream-5-0-pro-260628',
    'image',
    '豆包 Seedream 5.0 Pro',
    NULL,
    JSON_ARRAY(
        JSON_OBJECT('id', '1k', 'label', '1K', 'api_value', '1024x1024', 'width', 1024, 'height', 1024),
        JSON_OBJECT('id', '2k', 'label', '2K', 'api_value', '2048x2048', 'width', 2048, 'height', 2048),
        JSON_OBJECT('id', '4k', 'label', '4K', 'api_value', '4096x4096', 'width', 4096, 'height', 4096)
    ),
    JSON_ARRAY('1:1', '16:9', '9:16', '4:3', '3:4', '21:9'),
    JSON_ARRAY('png', 'jpeg'),
    '2K',
    'png',
    '1:1',
    JSON_OBJECT(
        'reference_image', TRUE,
        'max_reference_images', 10,
        'watermark', TRUE,
        'quantity_max', 4,
        'sequential_image_generation', TRUE,
        'stream', TRUE,
        'tools', TRUE
    ),
    1
)
ON DUPLICATE KEY UPDATE
    features = JSON_SET(
        COALESCE(features, JSON_OBJECT()),
        '$.reference_image', TRUE,
        '$.max_reference_images', 10
    ),
    enabled = 1,
    is_delete = 0;

-- ===== 3. 契约断言（fail-closed）：Pro 行就位 + max_reference_images 正确 =====

SET @missing := (
    SELECT GROUP_CONCAT(missing.what SEPARATOR ', ') FROM (
        (SELECT '缺 enabled Pro 行 volcengine/doubao-seedream-5-0-pro-260628' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM generation_model_capability
             WHERE provider_id = 'volcengine'
               AND model_id = 'doubao-seedream-5-0-pro-260628'
               AND capability_type = 'image'
               AND enabled = 1
               AND is_delete = 0
         ))
        UNION ALL
        (SELECT 'Pro 行 features.max_reference_images != 10' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM generation_model_capability
             WHERE provider_id = 'volcengine'
               AND model_id = 'doubao-seedream-5-0-pro-260628'
               AND capability_type = 'image'
               AND is_delete = 0
               AND JSON_EXTRACT(features, '$.max_reference_images') = 10
               AND JSON_EXTRACT(features, '$.reference_image') = TRUE
         ))
        UNION ALL
        (SELECT 'lite 行 features.max_reference_images 缺失' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM generation_model_capability
             WHERE provider_id = 'volcengine'
               AND model_id = 'doubao-seedream-5.0-lite'
               AND capability_type = 'image'
               AND is_delete = 0
               AND JSON_EXTRACT(features, '$.max_reference_images') = 4
         ))
    ) missing
);

SET @assert_sql := IF(@missing IS NULL,
    'SELECT ''V20 能力表 max_reference_images + Pro 行就绪'' AS v20_contract',
    CONCAT('V20_CONTRACT_VIOLATION [', SUBSTRING(@missing, 1, 200), ']'));
PREPARE stmt_assert FROM @assert_sql;
EXECUTE stmt_assert;
DEALLOCATE PREPARE stmt_assert;
