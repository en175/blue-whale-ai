SET NAMES utf8mb4;

-- IKE0VX：generation_model_capability 增加显式默认标记。
-- 在此之前「Agent 默认用哪个模型」由 sort_order 兼职决定：谁在管理后台调一次 text
-- 的排序，就等于改了所有新会话的默认模型，而那个字段在界面上叫「排序」。
-- 与 prisma/migrations/20260908160000_ike0vx_model_default_flag/migration.sql 双轨同步。
ALTER TABLE `generation_model_capability`
  ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT false
    COMMENT '该 capability_type 的显式默认模型；每类至多一条，由应用层保证' AFTER `sort_order`;

-- 每类至多一条不设 DB 条件唯一索引，由应用层单点保证（与 material_groups.is_default 同一
-- 处理，见 019）：MySQL 的部分唯一索引要靠生成列绕，代价大于收益，而写入只有一个入口。
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
