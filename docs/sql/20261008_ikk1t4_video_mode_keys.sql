SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      `features`,
      '$.task_types',
      CAST('{"text2video":{},"omni":{},"image_reference":{},"first_frame":{},"first_last_frame":{}}' AS JSON)
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND `model_id` = 'doubao-seedance-2-0-260128';

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      `features`,
      '$.task_types',
      CAST('{"text2video":{},"omni":{},"image_reference":{},"first_frame":{"allowed_ratios":["adaptive"]},"first_last_frame":{"allowed_ratios":["adaptive"]},"edit":{"allowed_ratios":["adaptive"],"allowed_durations":[-1]},"extend":{"allowed_ratios":["adaptive"]}}' AS JSON)
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND `model_id` = 'doubao-seedance-2-5-260628';

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      `features`,
      '$.task_types',
      CAST('{"text2video":{},"omni":{},"image_reference":{},"first_frame":{},"first_last_frame":{}}' AS JSON)
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND `model_id` NOT IN ('doubao-seedance-2-0-260128', 'doubao-seedance-2-5-260628');
