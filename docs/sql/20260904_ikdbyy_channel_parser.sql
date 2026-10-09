ALTER TABLE `generation_model_capability`
  ADD COLUMN `channel_parser` VARCHAR(32) NOT NULL DEFAULT 'seedream' AFTER `features`,
  ADD COLUMN `request_mapping` JSON NULL AFTER `channel_parser`;

INSERT IGNORE INTO generation_model_capability (
  provider_id, model_id, capability_type, model_label,
  supported_sizes, supported_aspect_ratios, supported_durations, supported_formats,
  default_size, default_format, default_aspect_ratio, default_duration,
  features, enabled, sort_order, channel_parser, request_mapping
) VALUES
  (
    'new-api', 'gpt-image-2', 'image', 'GPT Image 2',
    JSON_ARRAY(JSON_OBJECT('id', '1k', 'label', '1K'), JSON_OBJECT('id', '2k', 'label', '2K'), JSON_OBJECT('id', '4k', 'label', '4K')),
    JSON_ARRAY('1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '21:9'),
    NULL, JSON_ARRAY('png'), '1k', 'png', '1:1', NULL,
    JSON_OBJECT('quantity_max', 1), TRUE, 40, 'gpt',
    JSON_OBJECT('matrix', JSON_OBJECT(
      '1k', JSON_OBJECT('1:1', '1024x1024', '3:2', '1536x1024', '2:3', '1024x1536', '4:3', '1536x1024', '3:4', '1024x1536'),
      '2k', JSON_OBJECT('1:1', '2048x2048', '16:9', '2048x1152', '9:16', '1152x2048', '3:2', '2048x1360', '2:3', '1360x2048', '4:3', '2048x1536', '3:4', '1536x2048', '21:9', '2048x880'),
      '4k', JSON_OBJECT('16:9', '3840x2160', '9:16', '2160x3840')
    ))
  ),
  (
    'new-api', 'gpt-image-2-light', 'image', 'GPT Image 2 light',
    JSON_ARRAY(JSON_OBJECT('id', '1k', 'label', '1K'), JSON_OBJECT('id', '2k', 'label', '2K'), JSON_OBJECT('id', '4k', 'label', '4K')),
    JSON_ARRAY('1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '21:9'),
    NULL, JSON_ARRAY('png'), '1k', 'png', '1:1', NULL,
    JSON_OBJECT('quantity_max', 1), TRUE, 41, 'gpt',
    JSON_OBJECT('matrix', JSON_OBJECT(
      '1k', JSON_OBJECT('1:1', 'auto', '3:2', 'auto', '2:3', 'auto', '4:3', 'auto', '3:4', 'auto'),
      '2k', JSON_OBJECT('1:1', 'auto', '16:9', 'auto', '9:16', 'auto', '3:2', 'auto', '2:3', 'auto', '4:3', 'auto', '3:4', 'auto', '21:9', 'auto'),
      '4k', JSON_OBJECT('16:9', 'auto', '9:16', 'auto')
    ))
  ),
  (
    'new-api', 'nano-banana', 'image', 'nano-banana',
    JSON_ARRAY(JSON_OBJECT('id', '1k', 'label', '1K'), JSON_OBJECT('id', '2k', 'label', '2K'), JSON_OBJECT('id', '4k', 'label', '4K')),
    JSON_ARRAY('1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9'),
    NULL, JSON_ARRAY('png'), '1k', 'png', '1:1', NULL,
    JSON_OBJECT('quantity_max', 1), TRUE, 42, 'banana',
    JSON_OBJECT(
      'quality', JSON_OBJECT('1k', '1k', '2k', '2k', '4k', '4k'),
      'size', JSON_OBJECT('1:1', '1x1', '2:3', '2x3', '3:2', '3x2', '3:4', '3x4', '4:3', '4x3', '4:5', '4x5', '5:4', '5x4', '9:16', '9x16', '16:9', '16x9', '21:9', '21x9')
    )
  );
