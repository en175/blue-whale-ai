SET NAMES utf8mb4;

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
  sort_order,
  channel_parser,
  request_mapping
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
      'max_reference_images', 4,
      'watermark', TRUE,
      'quantity_max', 4,
      'sequential_image_generation', TRUE,
      'stream', TRUE,
      'tools', FALSE
    ),
    TRUE,
    10,
    'seedream',
    NULL
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
      'tools', FALSE,
      'first_frame', TRUE,
      'last_frame', TRUE,
      'first_last_frame', TRUE,
      'audio', FALSE,
      'video_reference', FALSE,
      'video_reference_max', 3,
      'audio_reference', FALSE,
      'audio_reference_max', 3,
      'image_reference_max', 1,
      'max_reference_duration_sec', 15,
      'task_types', JSON_OBJECT(
        'default', JSON_OBJECT('allowed_ratios', JSON_ARRAY('16:9', '9:16', '1:1'), 'allowed_durations', JSON_ARRAY(5, 10)),
        'first_frame', JSON_OBJECT('allowed_ratios', JSON_ARRAY('16:9', '9:16', '1:1')),
        'first_last_frame', JSON_OBJECT('allowed_ratios', JSON_ARRAY('16:9', '9:16', '1:1'))
      )
    ),
    TRUE,
    20,
    'seedream',
    NULL
  ),
  (
    'new-api',
    'doubao-seedance-2-5-260628',
    'video',
    '豆包 Seedance 2.5',
    JSON_ARRAY(
      JSON_OBJECT('id', '480p', 'label', '480P', 'api_value', '480p', 'width', 854, 'height', 480),
      JSON_OBJECT('id', '720p', 'label', '720P', 'api_value', '720p', 'width', 1280, 'height', 720),
      JSON_OBJECT('id', '1080p', 'label', '1080P', 'api_value', '1080p', 'width', 1920, 'height', 1080)
    ),
    JSON_ARRAY('21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'),
    JSON_OBJECT('min', 4, 'max', 30, 'step', 1),
    JSON_ARRAY('mp4', 'mov'),
    '720p',
    'mp4',
    '16:9',
    4,
    JSON_OBJECT(
      'reference_image', TRUE,
      'watermark', FALSE,
      'quantity_max', 1,
      'sequential_image_generation', FALSE,
      'stream', FALSE,
      'tools', TRUE,
      'first_frame', TRUE,
      'last_frame', TRUE,
      'first_last_frame', TRUE,
      'audio', TRUE,
      'video_reference', TRUE,
      'video_reference_max', 10,
      'audio_reference', TRUE,
      'audio_reference_max', 10,
      'image_reference_max', 30,
      'max_reference_duration_sec', 30,
      'task_types', JSON_OBJECT(
        'default', JSON_OBJECT('allowed_ratios', JSON_ARRAY('21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'), 'allowed_durations', JSON_ARRAY(4, 5, 6, 8, 10, 12, 15, 20, 25, 30)),
        'first_frame', JSON_OBJECT('allowed_ratios', JSON_ARRAY('adaptive')),
        'first_last_frame', JSON_OBJECT('allowed_ratios', JSON_ARRAY('adaptive')),
        'edit', JSON_OBJECT('allowed_ratios', JSON_ARRAY('adaptive'), 'allowed_durations', JSON_ARRAY(-1)),
        'prolong', JSON_OBJECT('allowed_ratios', JSON_ARRAY('adaptive'), 'allowed_durations', JSON_ARRAY(4, 5, 6, 8, 10, 12, 15, 20, 25, 30, -1))
      )
    ),
    TRUE,
    21,
    'seedream',
    NULL
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
    100,
    'seedream',
    NULL
  ),
  (
    'new-api',
    'seed-audio-1.0',
    'audio',
    '豆包 Seed Audio 1.0',
    JSON_ARRAY(),
    JSON_ARRAY(),
    JSON_ARRAY(1, 120),
    JSON_ARRAY('mp3'),
    '',
    'mp3',
    '',
    NULL,
    JSON_OBJECT('watermark', TRUE),
    TRUE,
    30,
    'seedream',
    NULL
  ),
  (
    'new-api',
    'gpt-image-2',
    'image',
    'GPT Image 2',
    JSON_ARRAY(
      JSON_OBJECT('id', '1k', 'label', '1K'),
      JSON_OBJECT('id', '2k', 'label', '2K'),
      JSON_OBJECT('id', '4k', 'label', '4K')
    ),
    JSON_ARRAY('1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '21:9'),
    NULL,
    JSON_ARRAY('png'),
    '1k',
    'png',
    '1:1',
    NULL,
    JSON_OBJECT(
      'quantity_max', 1,
      'max_reference_images', 16,
      'reference_image', TRUE,
      'video_reference_max', 0,
      'audio_reference_max', 0,
      'image_reference_max', 1
    ),
    TRUE,
    40,
    'gpt',
    JSON_OBJECT(
      'matrix', JSON_OBJECT(
        '1k', JSON_OBJECT(
          '1:1', '1024x1024',
          '3:2', '1536x1024',
          '2:3', '1024x1536',
          '4:3', '1536x1024',
          '3:4', '1024x1536'
        ),
        '2k', JSON_OBJECT(
          '1:1', '2048x2048',
          '16:9', '2048x1152',
          '9:16', '1152x2048',
          '3:2', '2048x1360',
          '2:3', '1360x2048',
          '4:3', '2048x1536',
          '3:4', '1536x2048',
          '21:9', '2048x880'
        ),
        '4k', JSON_OBJECT(
          '16:9', '3840x2160',
          '9:16', '2160x3840'
        )
      )
    )
  ),
  (
    'new-api',
    'gpt-image-2-light',
    'image',
    'GPT Image 2 light',
    JSON_ARRAY(
      JSON_OBJECT('id', '1k', 'label', '1K'),
      JSON_OBJECT('id', '2k', 'label', '2K'),
      JSON_OBJECT('id', '4k', 'label', '4K')
    ),
    JSON_ARRAY('1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '21:9'),
    NULL,
    JSON_ARRAY('png'),
    '1k',
    'png',
    '1:1',
    NULL,
    JSON_OBJECT('quantity_max', 1),
    TRUE,
    41,
    'gpt',
    JSON_OBJECT(
      'matrix', JSON_OBJECT(
        '1k', JSON_OBJECT(
          '1:1', 'auto',
          '3:2', 'auto',
          '2:3', 'auto',
          '4:3', 'auto',
          '3:4', 'auto'
        ),
        '2k', JSON_OBJECT(
          '1:1', 'auto',
          '16:9', 'auto',
          '9:16', 'auto',
          '3:2', 'auto',
          '2:3', 'auto',
          '4:3', 'auto',
          '3:4', 'auto',
          '21:9', 'auto'
        ),
        '4k', JSON_OBJECT(
          '16:9', 'auto',
          '9:16', 'auto'
        )
      )
    )
  ),
  (
    'new-api',
    'nano-banana',
    'image',
    'nano-banana',
    JSON_ARRAY(
      JSON_OBJECT('id', '1k', 'label', '1K'),
      JSON_OBJECT('id', '2k', 'label', '2K'),
      JSON_OBJECT('id', '4k', 'label', '4K')
    ),
    JSON_ARRAY('1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9'),
    NULL,
    JSON_ARRAY('png'),
    '1k',
    'png',
    '1:1',
    NULL,
    JSON_OBJECT('quantity_max', 1),
    TRUE,
    42,
    'banana',
    JSON_OBJECT(
      'quality', JSON_OBJECT('1k', '1k', '2k', '2k', '4k', '4k'),
      'size', JSON_OBJECT(
        '1:1', '1x1',
        '2:3', '2x3',
        '3:2', '3x2',
        '3:4', '3x4',
        '4:3', '4x3',
        '4:5', '4x5',
        '5:4', '5x4',
        '9:16', '9x16',
        '16:9', '16x9',
        '21:9', '21x9'
      )
    )
  );
