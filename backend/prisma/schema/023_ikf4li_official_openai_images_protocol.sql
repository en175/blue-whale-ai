SET NAMES utf8mb4;

-- IKF4LI：gpt-image-2 上游换成官方 OpenAI Images 协议，worker 出站形态按
-- features.image_protocol 分流。本迁移把 022 的合并主行从「id 漂移名」
-- gpt-image-2-text-to-image 迁回干净名 gpt-image-2（= 上游模型名，出站零映射），
-- 并为其声明 openai-images 协议；banana 行显式声明 inline-image 保留现状。
-- 与 prisma/migrations/20260911120000_ikf4li_official_openai_images_protocol/migration.sql 双轨同步。
--
-- 背景（2026-09-11 实测）：上游 gpt-image-2 只认官方协议——
--   generations 带 image 字段 → 400 Unknown parameter: 'image'
--   带 response_format     → 400 Unknown parameter: 'response_format'
--   图生图必须走 /v1/images/edits multipart，且模型名恒为 gpt-image-2（不换名）。
-- 故 022 引入的 features.i2i_model_name 对 gpt-image-2 作废（机制保留给 banana）。
--
-- 改名不做数据迁移：老画布节点/历史 job 里存的 gpt-image-2-text-to-image 不再被解析
-- （用户 2026-09-11 拍板不加兼容别名），重跑需重选模型。

-- 1) 主行迁回 gpt-image-2：该行由 015 创建后停用未删，占着 uk_provider_model 干净名
--    （唯一键含软删行），故走 UPSERT——存在则改写并复活，fresh 环境则新建。
INSERT INTO generation_model_capability (
  provider_id, model_id, capability_type, model_label,
  supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
  default_size, default_format, default_aspect_ratio, default_duration,
  features, channel_parser, request_mapping, enabled, sort_order
) VALUES
  (
    'new-api', 'gpt-image-2', 'image', 'GPT Image 2',
    JSON_ARRAY(JSON_OBJECT('id', '1k', 'label', '1K', 'api_value', '1K'), JSON_OBJECT('id', '2k', 'label', '2K', 'api_value', '2K'), JSON_OBJECT('id', '4k', 'label', '4k')),
    JSON_ARRAY('1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3'),
    NULL, JSON_ARRAY(), '2k', NULL, '1:1', NULL,
    JSON_OBJECT(
      'stream', TRUE, 'watermark', TRUE, 'quantity_max', 15,
      'reference_image', TRUE, 'max_reference_images', 10,
      'sequential_image_generation', TRUE,
      'image_protocol', 'openai-images', 'max_prompt_length', 32000
    ),
    'gpt',
    JSON_OBJECT('matrix', JSON_OBJECT(
      '1k', JSON_OBJECT('1:1', '1024x1024', '2:3', '1024x1536', '3:2', '1536x1024'),
      '2k', JSON_OBJECT('1:1', '2048x2048', '1:2', '1024x2048', '1:3', '688x2048', '2:1', '2048x1024', '2:3', '1360x2048', '3:1', '2048x688', '3:2', '2048x1360', '3:4', '1536x2048', '4:3', '2048x1536', '16:9', '2048x1152', '21:9', '2048x880', '9:16', '1152x2048', '9:21', '880x2048'),
      '4k', JSON_OBJECT('16:9', '3840x2160', '9:16', '2160x3840')
    )),
    TRUE, 108
  )
ON DUPLICATE KEY UPDATE
  capability_type = VALUES(capability_type),
  model_label = VALUES(model_label),
  supported_sizes = VALUES(supported_sizes),
  supported_aspect_ratios = VALUES(supported_aspect_ratios),
  supported_formats = VALUES(supported_formats),
  default_size = VALUES(default_size),
  default_format = VALUES(default_format),
  default_aspect_ratio = VALUES(default_aspect_ratio),
  features = VALUES(features),
  channel_parser = VALUES(channel_parser),
  request_mapping = VALUES(request_mapping),
  enabled = VALUES(enabled),
  is_delete = FALSE,
  sort_order = VALUES(sort_order),
  version = version + 1,
  gmt_modified = NOW();

-- 2) 退役漂移名主行（画布节点重跑需重选模型，与 ADR-0085 同类代价，本次不提供别名）。
UPDATE generation_model_capability
   SET enabled = FALSE, is_delete = TRUE, version = version + 1, gmt_modified = NOW()
 WHERE provider_id = 'new-api'
   AND model_id = 'gpt-image-2-text-to-image'
   AND is_delete = FALSE;

-- 3) banana 显式声明旧形态（恒 generations + body.image，参考图时可配 i2i_model_name 换名）。
--    不写也能靠 worker 缺省走 inline-image，此处显式化以免读代码要靠记默认值。
UPDATE generation_model_capability
   SET features = JSON_SET(COALESCE(features, JSON_OBJECT()), '$.image_protocol', 'inline-image'),
       version = version + 1,
       gmt_modified = NOW()
 WHERE provider_id = 'new-api'
   AND model_id = 'nano-banana-2-t2i'
   AND is_delete = FALSE;
