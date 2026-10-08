SET NAMES utf8mb4;

ALTER TABLE `generation_model_capability`
  ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false
    COMMENT '该 capability_type 的显式默认模型；每类至多一条，由应用层保证' AFTER `sort_order`;

UPDATE `generation_model_capability`
SET `is_default` = true
WHERE `id` = (
  SELECT `id` FROM (
    SELECT `id` FROM `generation_model_capability`
    WHERE `capability_type` = 'text' AND `enabled` = true AND `is_delete` = false
    ORDER BY `sort_order` ASC, `id` ASC
    LIMIT 1
  ) AS `t`
);
