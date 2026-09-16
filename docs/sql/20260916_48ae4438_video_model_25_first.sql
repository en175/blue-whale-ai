-- 视频模型目录置顶 Seedance 2.5（worktree feature-48ae4438，无工单号）。
--
-- 背景：视频面板模型下拉顺序 = GET /api/generation/models 返回顺序 =
-- generation_model_capability.sort_order 升序，且前端默认选中列表第一条
-- （BottomDialog 取 list[0]）。产品要求 Seedance 2.5
-- （doubao-seedance-2-5-260628）排视频目录第一位，即成为默认选中模型。
--
-- 各环境 sort_order 存量值不同（seed 基线 2.0=20 / 2.5=21；测试站另有手工
-- 插入的 Fast/Mini 变体行），故不写死目标值：取本环境视频目录「其他启用行」
-- 的最小 sort_order 减 10，保证 2.5 必排最前。视频目录只剩 2.5 一行时
-- COALESCE 兜底 -10，避免 NOT NULL 列吃 NULL 使迁移失败。派生表是为了绕开
-- MySQL 不允许 UPDATE 直接引用同表子查询的限制（与 IKE0VX 同款写法）。
--
-- 不按 provider_id 过滤：唯一键是 (provider_id, model_id)，同 model_id 的
-- 重复行一并置顶是正确语义（与 IKG4UR 同款口径）。
--
-- 双轨：本文件与 backend/prisma/schema/027_48ae4438_video_model_25_first.sql、
--       docs/sql/20260916_48ae4438_video_model_25_first.sql 内容需逐字一致
--       （有 parity 测试断言）。

SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `sort_order` = COALESCE((
      SELECT `m` - 10 FROM (
        SELECT MIN(`sort_order`) AS `m` FROM `generation_model_capability`
        WHERE `capability_type` = 'video'
          AND `model_id` <> 'doubao-seedance-2-5-260628'
          AND `enabled` = true
          AND `is_delete` = 0
      ) AS `t`
    ), -10)
WHERE `model_id` = 'doubao-seedance-2-5-260628' AND `is_delete` = 0;
