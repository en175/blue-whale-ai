SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      `features`,
      '$.task_types.extend.allow_auto_duration', CAST('true' AS JSON)
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND `model_id` = 'doubao-seedance-2-5-260628'
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.task_types.extend')) = 'OBJECT';
