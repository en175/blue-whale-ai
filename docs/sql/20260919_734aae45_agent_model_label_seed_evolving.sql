
SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `model_label` = 'Seed-Evolving'
WHERE `model_id` = 'doubao-seed-evolving' AND `is_delete` = 0;
