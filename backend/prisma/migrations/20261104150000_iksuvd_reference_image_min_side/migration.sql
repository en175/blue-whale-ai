SET NAMES utf8mb4;

UPDATE `catalog_models`
SET `features` = JSON_SET(
  COALESCE(`features`, JSON_OBJECT()),
  '$.min_reference_image_side', 300
),
  `version` = `version` + 1,
  `gmt_modified` = NOW()
WHERE `capability_type` = 'video'
  AND `model_id` LIKE 'doubao-seedance-%'
  AND `is_delete` = 0;
