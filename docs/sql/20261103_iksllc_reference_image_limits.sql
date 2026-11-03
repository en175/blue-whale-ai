SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
  COALESCE(`features`, JSON_OBJECT()),
  '$.max_reference_image_pixels', 36000000,
  '$.max_reference_image_ratio', 2.5
)
WHERE `capability_type` = 'video'
  AND `model_id` LIKE 'doubao-seedance-%'
  AND `is_delete` = 0;

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
  COALESCE(`features`, JSON_OBJECT()),
  '$.max_reference_image_bytes', 10485760
)
WHERE `capability_type` = 'audio'
  AND `model_id` = 'seed-audio-1.0'
  AND `is_delete` = 0;
