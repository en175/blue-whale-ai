SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.seconds',
      'basePrice', JSON_OBJECT(
          'kind', 'table',
          'by', JSON_ARRAY('resolution', 'video'),
          'table', JSON_OBJECT(
              'resolution=480p|video=0', 13000,
              'resolution=480p|video=1', 20000,
              'resolution=720p|video=0', 27000,
              'resolution=720p|video=1', 49000,
              'resolution=1080p|video=0', 68000,
              'resolution=1080p|video=1', 110000,
              'resolution=4k|video=0', 140000,
              'resolution=4k|video=1', 260000
          )
      ),
      'multipliers', JSON_OBJECT('usage.videoEdit', 20000),
      'unitDenominator', 1,
      'minCredits', 1
    )
WHERE `model_id` = 'doubao-seedance-2-0-260128'
  AND `capability_type` = 'video'
  AND `is_delete` = 0;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.seconds',
      'basePrice', JSON_OBJECT(
          'kind', 'table',
          'by', JSON_ARRAY('resolution', 'video'),
          'table', JSON_OBJECT(
              'resolution=480p|video=0', 10000,
              'resolution=480p|video=1', 16000,
              'resolution=720p|video=0', 22000,
              'resolution=720p|video=1', 41000
          )
      ),
      'multipliers', JSON_OBJECT('usage.videoEdit', 20000),
      'unitDenominator', 1,
      'minCredits', 1
    )
WHERE `model_id` = 'doubao-seedance-2-0-fast-260128'
  AND `capability_type` = 'video'
  AND `is_delete` = 0;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.seconds',
      'basePrice', JSON_OBJECT(
          'kind', 'table',
          'by', JSON_ARRAY('resolution', 'video'),
          'table', JSON_OBJECT(
              'resolution=480p|video=0', 8000,
              'resolution=480p|video=1', 9000,
              'resolution=720p|video=0', 16000,
              'resolution=720p|video=1', 20000
          )
      ),
      'multipliers', JSON_OBJECT('usage.videoEdit', 20000),
      'unitDenominator', 1,
      'minCredits', 1
    )
WHERE `model_id` = 'doubao-seedance-2-0-mini-260615'
  AND `capability_type` = 'video'
  AND `is_delete` = 0;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.seconds',
      'basePrice', JSON_OBJECT(
          'kind', 'table',
          'by', JSON_ARRAY('resolution', 'video'),
          'table', JSON_OBJECT(
              'resolution=480p|video=0', 20000,
              'resolution=480p|video=1', 20000,
              'resolution=720p|video=0', 46000,
              'resolution=720p|video=1', 46000,
              'resolution=1080p|video=0', 110000,
              'resolution=1080p|video=1', 110000
          )
      ),
      'dims', JSON_OBJECT('usage.referenceSeconds', 10000),
      'multipliers', JSON_OBJECT('usage.videoEdit', 20000),
      'unitDenominator', 1,
      'minCredits', 1
    )
WHERE `model_id` = 'doubao-seedance-2-5-260628'
  AND `capability_type` = 'video'
  AND `is_delete` = 0;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.characters',
      'basePrice', JSON_OBJECT('kind', 'const', 'value', 10),
      'unitDenominator', 1,
      'minCredits', 1
    )
WHERE `model_id` = 'seed-audio-1.0'
  AND `capability_type` = 'audio'
  AND `is_delete` = 0;
