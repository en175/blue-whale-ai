INSERT INTO generation_model_capability (
  provider_id,
  model_id,
  capability_type,
  model_label,
  supported_sizes,
  supported_aspect_ratios,
  supported_durations,
  supported_formats,
  default_size,
  default_format,
  default_aspect_ratio,
  default_duration,
  features,
  enabled,
  sort_order
) VALUES
  (
    'volcengine',
    'doubao-seedream-4-0-250828',
    'image',
    '豆包 Seedream 4.0',
    JSON_ARRAY(
      JSON_OBJECT('id', '1k', 'label', '1K', 'api_value', '1K', 'width', 1024, 'height', 1024),
      JSON_OBJECT('id', '2k', 'label', '2K', 'api_value', '2K', 'width', 2048, 'height', 2048)
    ),
    JSON_ARRAY('1:1', '16:9', '9:16', '4:3', '3:4'),
    NULL,
    JSON_ARRAY('png', 'jpeg'),
    '1K',
    'png',
    '1:1',
    NULL,
    JSON_OBJECT(
      'reference_image', TRUE,
      'watermark', TRUE,
      'quantity_max', 4,
      'sequential_image_generation', TRUE,
      'stream', TRUE,
      'tools', FALSE
    ),
    TRUE,
    10
  ),
  (
    'new-api',
    'doubao-seedance-2-0-260128',
    'video',
    '豆包 Seedance 2.0',
    JSON_ARRAY(
      JSON_OBJECT('id', '720p', 'label', '720P', 'api_value', '720p', 'width', 1280, 'height', 720),
      JSON_OBJECT('id', '1080p', 'label', '1080P', 'api_value', '1080p', 'width', 1920, 'height', 1080)
    ),
    JSON_ARRAY('16:9', '9:16', '1:1'),
    JSON_ARRAY(5, 10),
    JSON_ARRAY('mp4'),
    '720p',
    'mp4',
    '16:9',
    5,
    JSON_OBJECT(
      'reference_image', TRUE,
      'watermark', FALSE,
      'quantity_max', 1,
      'sequential_image_generation', FALSE,
      'stream', FALSE,
      'tools', FALSE
    ),
    TRUE,
    20
  ),
  (
    'volcengine',
    'MiniMax-M3',
    'text',
    'MiniMax-M3',
    JSON_ARRAY(),
    JSON_ARRAY(),
    NULL,
    JSON_ARRAY(),
    '',
    NULL,
    '',
    NULL,
    JSON_OBJECT(),
    TRUE,
    100
  );
