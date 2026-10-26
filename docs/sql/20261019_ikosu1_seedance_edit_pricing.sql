SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `pricing` = JSON_MERGE_PATCH(
      `pricing`,
      JSON_OBJECT(
        'dims', JSON_OBJECT('usage.referenceSeconds', 10000, 'usage.videoEdit', 150000),
        'multipliers', NULL
      )
    ),
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedance-2-5-260628'
  AND `capability_type` = 'video'
  AND `is_delete` = 0
  AND JSON_TYPE(`pricing`) = 'OBJECT';
