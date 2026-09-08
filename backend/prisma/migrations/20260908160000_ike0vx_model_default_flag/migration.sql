-- IKE0VX：模型目录增加显式默认标记，取代 sort_order 兼职决定 Agent 默认模型。
ALTER TABLE `generation_model_capability`
  ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false
    COMMENT '该 capability_type 的显式默认模型；每类至多一条，由应用层保证' AFTER `sort_order`;

-- 回填：把「今天事实上的默认」原样钉住，行为一个字不变。
-- 不写死 MiniMax-M3——各环境目录不同，写死会在别的库里钉错行。取当前 text 里排序
-- 最靠前的启用行，也就是前端此刻正在选中的那一条。目录为空时不更新任何行。
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
