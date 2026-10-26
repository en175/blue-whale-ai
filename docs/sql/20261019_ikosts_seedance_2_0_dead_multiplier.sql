SET NAMES utf8mb4;

START TRANSACTION;

UPDATE `generation_model_capability`
SET `pricing` = CASE
      WHEN JSON_LENGTH(`pricing`, '$.multipliers') = 1
        THEN JSON_REMOVE(`pricing`, '$.multipliers')
      ELSE JSON_REMOVE(`pricing`, '$.multipliers."usage.videoEdit"')
    END,
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedance-2-0-260128'
  AND `capability_type` = 'video'
  AND `is_delete` = 0
  AND JSON_TYPE(`pricing`) = 'OBJECT'
  AND JSON_CONTAINS_PATH(`pricing`, 'one', '$.multipliers."usage.videoEdit"');

UPDATE `generation_model_capability`
SET `pricing` = CASE
      WHEN JSON_LENGTH(`pricing`, '$.multipliers') = 1
        THEN JSON_REMOVE(`pricing`, '$.multipliers')
      ELSE JSON_REMOVE(`pricing`, '$.multipliers."usage.videoEdit"')
    END,
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedance-2-0-fast-260128'
  AND `capability_type` = 'video'
  AND `is_delete` = 0
  AND JSON_TYPE(`pricing`) = 'OBJECT'
  AND JSON_CONTAINS_PATH(`pricing`, 'one', '$.multipliers."usage.videoEdit"');

UPDATE `generation_model_capability`
SET `pricing` = CASE
      WHEN JSON_LENGTH(`pricing`, '$.multipliers') = 1
        THEN JSON_REMOVE(`pricing`, '$.multipliers')
      ELSE JSON_REMOVE(`pricing`, '$.multipliers."usage.videoEdit"')
    END,
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedance-2-0-mini-260615'
  AND `capability_type` = 'video'
  AND `is_delete` = 0
  AND JSON_TYPE(`pricing`) = 'OBJECT'
  AND JSON_CONTAINS_PATH(`pricing`, 'one', '$.multipliers."usage.videoEdit"');

COMMIT;
