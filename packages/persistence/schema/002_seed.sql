INSERT INTO generation_providers (
  provider_id,
  provider_kind,
  enabled,
  config_json
) VALUES (
  'fake',
  'deterministic_fake',
  TRUE,
  JSON_OBJECT('version', 1)
);

INSERT INTO generation_model_capabilities (
  model_id,
  provider_id,
  media_type,
  capability_json,
  enabled
) VALUES
  (
    'fake-image-v1',
    'fake',
    'image',
    JSON_OBJECT('sizes', JSON_ARRAY('1024x1024'), 'max_outputs', 4),
    TRUE
  ),
  (
    'fake-video-v1',
    'fake',
    'video',
    JSON_OBJECT('durations_seconds', JSON_ARRAY(5), 'max_outputs', 1),
    TRUE
  );
