SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.characters',
      'basePrice', JSON_OBJECT('kind', 'const', 'value', 19000),
      'unitDenominator', 100,
      'quantityStep', 100,
      'rounding', 'halfUp',
      'minCredits', 1
    )
WHERE `model_id` = 'seed-audio-1.0'
  AND `capability_type` = 'audio'
  AND `is_delete` = 0;
