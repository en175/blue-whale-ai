SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      JSON_REMOVE(`features`, '$.task_types.edit.allow_auto_duration'),
      '$.task_types.edit.allowed_durations', JSON_ARRAY(-1)
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.task_types.edit')) = 'OBJECT';

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      JSON_REMOVE(`features`, '$.task_types.extend.allowed_durations'),
      '$.task_types.extend.allow_auto_duration', CAST('true' AS JSON)
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.task_types.extend')) = 'OBJECT';

UPDATE `generation_model_capability`
SET `features` = JSON_REMOVE(
      `features`,
      '$.task_types.text2video.allowed_durations',
      '$.task_types.text2video.allow_auto_duration',
      '$.task_types.omni.allowed_durations',
      '$.task_types.omni.allow_auto_duration',
      '$.task_types.image_reference.allowed_durations',
      '$.task_types.image_reference.allow_auto_duration',
      '$.task_types.first_frame.allowed_durations',
      '$.task_types.first_frame.allow_auto_duration',
      '$.task_types.first_last_frame.allowed_durations',
      '$.task_types.first_last_frame.allow_auto_duration'
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.task_types')) = 'OBJECT';

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      JSON_REMOVE(`features`, '$.taskTypes.edit.allow_auto_duration'),
      '$.taskTypes.edit.allowed_durations', JSON_ARRAY(-1)
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.taskTypes.edit')) = 'OBJECT';

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      JSON_REMOVE(`features`, '$.taskTypes.extend.allowed_durations'),
      '$.taskTypes.extend.allow_auto_duration', CAST('true' AS JSON)
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.taskTypes.extend')) = 'OBJECT';

UPDATE `generation_model_capability`
SET `features` = JSON_REMOVE(
      `features`,
      '$.taskTypes.text2video.allowed_durations',
      '$.taskTypes.text2video.allow_auto_duration',
      '$.taskTypes.omni.allowed_durations',
      '$.taskTypes.omni.allow_auto_duration',
      '$.taskTypes.image_reference.allowed_durations',
      '$.taskTypes.image_reference.allow_auto_duration',
      '$.taskTypes.first_frame.allowed_durations',
      '$.taskTypes.first_frame.allow_auto_duration',
      '$.taskTypes.first_last_frame.allowed_durations',
      '$.taskTypes.first_last_frame.allow_auto_duration'
    )
WHERE `is_delete` = 0
  AND `capability_type` = 'video'
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.taskTypes')) = 'OBJECT';
