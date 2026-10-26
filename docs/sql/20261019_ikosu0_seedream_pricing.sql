SET NAMES utf8mb4;

START TRANSACTION;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.succeededSlots',
      'basePrice', JSON_OBJECT(
        'kind', 'table',
        'by', JSON_ARRAY('size', 'image_reference'),
        'table', JSON_OBJECT(
          'size=1k|image_reference=0', 7000,
          'size=1.5k|image_reference=0', 8000,
          'size=2k|image_reference=0', 14000,
          'size=1k|image_reference=1', 9000,
          'size=1.5k|image_reference=1', 10000,
          'size=2k|image_reference=1', 16000
        )
      ),
      'unitDenominator', 1,
      'minCredits', 1
    ),
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedream-5-0-pro-260628'
  AND `capability_type` = 'image'
  AND `is_delete` = 0
  AND JSON_TYPE(`pricing`) = 'OBJECT';

UPDATE `generation_model_capability`
SET `pricing` = JSON_SET(`pricing`, '$.basePrice', JSON_OBJECT('kind', 'const', 'value', 4000)),
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedream-5-0-260128'
  AND `capability_type` = 'image'
  AND `is_delete` = 0
  AND JSON_TYPE(`pricing`) = 'OBJECT';

UPDATE `generation_model_capability`
SET `supported_sizes` = JSON_ARRAY_APPEND(`supported_sizes`, '$', CAST('{"id":"3k","label":"3K","api_value":"3K"}' AS JSON)),
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedream-5-0-260128'
  AND `capability_type` = 'image'
  AND `is_delete` = 0
  AND JSON_TYPE(`supported_sizes`) = 'ARRAY'
  AND JSON_SEARCH(`supported_sizes`, 'one', '3k', NULL, '$[*].id') IS NULL;

UPDATE `generation_model_capability`
SET `supported_sizes` = JSON_ARRAY_APPEND(`supported_sizes`, '$', CAST('{"id":"4k","label":"4K","api_value":"4K"}' AS JSON)),
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedream-5-0-260128'
  AND `capability_type` = 'image'
  AND `is_delete` = 0
  AND JSON_TYPE(`supported_sizes`) = 'ARRAY'
  AND JSON_SEARCH(`supported_sizes`, 'one', '4k', NULL, '$[*].id') IS NULL;

UPDATE `generation_model_capability`
SET `pricing` = JSON_SET(
      `pricing`,
      '$.baseUnit', 'usage.succeededSlots',
      '$.basePrice', JSON_OBJECT('kind', 'const', 'value', 4000)
    ),
    `version` = `version` + 1
WHERE `model_id` = 'doubao-seedream-4-5-251128'
  AND `capability_type` = 'image'
  AND `is_delete` = 0
  AND JSON_TYPE(`pricing`) = 'OBJECT';

COMMIT;
