SET NAMES utf8mb4;

START TRANSACTION;

UPDATE `generation_model_capability`
SET `features` = JSON_SET(
      `features`,
      '$.video_reference', CAST('true' AS JSON),
      '$.video_reference_max', 3,
      '$.audio_reference', CAST('true' AS JSON),
      '$.audio_reference_max', 3
    ),
    `version` = `version` + 1,
    `gmt_modified` = NOW()
WHERE `model_id` IN (
        'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-2-0-mini-260615'
      )
  AND `capability_type` = 'video'
  AND `is_delete` = 0;

COMMIT;
