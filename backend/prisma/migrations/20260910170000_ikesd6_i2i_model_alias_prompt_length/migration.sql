SET NAMES utf8mb4;

-- IKESD6 / ADR-0085：image-2 与 banana2 的「文生图 / 图生图」双行目录合并为一档。
-- 主行 features 承载 i2i_model_name（有参考图时 worker 出站改用的上游模型名）与
-- max_prompt_length（image-2=32000）；被合并的分裂行软删（is_delete=1，唯一键占名，永久不可复用）。
-- 与 prisma/migrations/20260910170000_ikesd6_i2i_model_alias_prompt_length/migration.sql 双轨同步。
-- 列值以测试站 2026-09-10 实查为准（消除测试站漂移回写）。

-- 1) 主行 upsert：测试站已有行 → UPDATE 合并；fresh 环境无行 → INSERT 创建。
INSERT INTO generation_model_capability (
  provider_id, model_id, capability_type, model_label,
  supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
  default_size, default_format, default_aspect_ratio, default_duration,
  features, channel_parser, request_mapping, enabled, sort_order
) VALUES
  (
    'new-api', 'gpt-image-2-text-to-image', 'image', 'GPT Image 2',
    JSON_ARRAY(JSON_OBJECT('id', '1k', 'label', '1K', 'api_value', '1K'), JSON_OBJECT('id', '2k', 'label', '2K', 'api_value', '2K'), JSON_OBJECT('id', '4k', 'label', '4k')),
    JSON_ARRAY('1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3'),
    NULL, JSON_ARRAY(), '2k', NULL, '1:1', NULL,
    JSON_OBJECT(
      'stream', TRUE, 'watermark', TRUE, 'quantity_max', 15,
      'reference_image', TRUE, 'max_reference_images', 10,
      'sequential_image_generation', TRUE,
      'i2i_model_name', 'gpt-image-2-edit', 'max_prompt_length', 32000
    ),
    'gpt',
    JSON_OBJECT('matrix', JSON_OBJECT(
      '1k', JSON_OBJECT('1:1', '1024x1024', '2:3', '1024x1536', '3:2', '1536x1024'),
      '2k', JSON_OBJECT('1:1', '2048x2048', '1:2', '1024x2048', '1:3', '688x2048', '2:1', '2048x1024', '2:3', '1360x2048', '3:1', '2048x688', '3:2', '2048x1360', '3:4', '1536x2048', '4:3', '2048x1536', '16:9', '2048x1152', '21:9', '2048x880', '9:16', '1152x2048', '9:21', '880x2048'),
      '4k', JSON_OBJECT('16:9', '3840x2160', '9:16', '2160x3840')
    )),
    TRUE, 108
  ),
  (
    'new-api', 'nano-banana-2-t2i', 'image', 'Banana 2',
    JSON_ARRAY(JSON_OBJECT('id', '1k', 'label', '1K'), JSON_OBJECT('id', '2k', 'label', '2K'), JSON_OBJECT('id', '4k', 'label', '4K')),
    JSON_ARRAY('1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9'),
    NULL, JSON_ARRAY('png'), '1k', 'png', '1:1', NULL,
    JSON_OBJECT(
      'quantity_max', 1,
      'i2i_model_name', 'nano-banana-2-i2i'
    ),
    'banana',
    JSON_OBJECT(
      'quality', JSON_OBJECT('1k', '1k', '2k', '2k', '4k', '4k'),
      'size', JSON_OBJECT('1:1', '1x1', '2:3', '2x3', '3:2', '3x2', '3:4', '3x4', '4:3', '4x3', '4:5', '4x5', '5:4', '5x4', '9:16', '9x16', '16:9', '16x9', '21:9', '21x9')
    ),
    TRUE, 110
  )
ON DUPLICATE KEY UPDATE
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
  sort_order = VALUES(sort_order),
  version = version + 1,
  gmt_modified = NOW();

-- 2) 被合并 / 退役的分裂行软删（画布节点重跑需重选模型，代价已在 ADR-0085 记录）。
--    light 双行全库零引用（2026-09-10 测试站实查）；fresh 环境无这些行，UPDATE 自然空操作。
UPDATE generation_model_capability
   SET enabled = FALSE, is_delete = TRUE, version = version + 1, gmt_modified = NOW()
 WHERE provider_id = 'new-api'
   AND model_id IN ('gpt-image-2-edit', 'nano-banana-2-i2i',
                    'gpt-image-2-light-edit', 'gpt-image-2-light-text-to-image')
   AND is_delete = FALSE;
