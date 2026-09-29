-- 退役计划通道（PlanMessage）残留：拆掉代码侧读取 + 放宽 scene_card_generation_records 两个溯源列为 NULL-able。
--
-- ⚠️ **本迁移不删表。** `plan_messages` / `plan_application_receipts` 的 DROP 落在后续迁移，
--    前置条件（两张表在目标库零行）尚未核对 —— 见下面「为什么这次不删表」。
--
-- ── 背景 ──────────────────────────────────────────────────────────────────────
-- `plan_messages`（计划卡冻结态）与 `plan_application_receipts`（一次成功应用的不可变回执）是
-- 「Agent 写出计划卡 → 用户点应用 → 落成 SceneCard / 图片 Job」这条流水线的两张表。
-- **写入方已随两次退役删除**：
--   * IKCKOW（2026-09-02，「删除旧 Agent 运行表及残留死代码」）→ 删掉 `plan_messages` 的写入；
--   * IKD806（2026-09-04，「删除 plan-application 写路径死代码(persistence 层)」）→ 删掉应用回执的写入，
--     2222 行 / 12 文件。写路径函数名 `applyImageGenerateInTransaction` 现在只活在一个注释里。
-- 2026-09-09 的 IKEEFV 清掉了同批遗留的 3 张零行悬空表，**这两张被漏下**。
--
-- ── 代码侧读取已在同一变更里全部拆掉 ──────────────────────────────────────────
--   * 快照投影 `plan_messages` / `plan_applications`（前端全仓零读取）；
--   * `generation-preset` 端点的 `projection`（前端只声明类型、不读，且其 fetch 函数零调用）；
--   * `regenerateSceneCard` 的「首次 Receipt」硬门槛 —— 它还会把**无回执的场景卡**
--     （如经素材库 `copySceneCardToProject` 复制来的）挡在生成之外，拆掉同时修掉这个缺陷。
-- 因此本迁移落地后，两张表**全仓零读取**。
--
-- ── 为什么这次不删表 ──────────────────────────────────────────────────────────
-- 沿用 IKEEFV 的判据 **「零行才删」**；而本次无法核对目标库行数（实现环境拿不到测试站 DB 凭据）。
-- 写入方删除距今仅约 3.5 周，生产库里存在 IKCKOW/IKD806 之前写下的历史行是**完全可能的**。
-- DROP 不可逆，且删掉后没有任何读取方会察觉 —— 所以按保守口径**先不删**：
--   * 表留在库里，零读取、零写入，无功能代价；
--   * DROP 在后续迁移里补齐，前置条件是下面这两条 COUNT 均为 0。
--
-- ── DROP 迁移的前置校验（届时须有输出）────────────────────────────────────────
--   SELECT COUNT(*) FROM plan_messages;
--   SELECT COUNT(*) FROM plan_application_receipts;
-- 任一非零 → 按 IKEEFV 的「只报告不删」保留表，DROP 迁移不再落地。
-- 另：届时 DROP 前应确认全库无 FOREIGN KEY / 视图 / 触发器指向这两张表
-- （IKEEFV 的核实只覆盖它自己删的 3 张，不构成对这两张的结论）。
--
-- ── 本迁移实际做什么 ──────────────────────────────────────────────────────────
-- `scene_card_generation_records.plan_message_id` / `application_receipt_id` 是 NOT NULL **且有历史值**，
-- 按 IKEEFV「只报告不删」**保留列**，只放宽为 NULL-able —— 代码侧不再写入，历史行原值不动。
-- 放宽是必需的：写入方删除后新行无值可填，不放宽则 `regenerateSceneCard` 写库直接失败。
-- 基线定义见 `001_baseline.sql`：两列均为 `BIGINT NOT NULL`、无默认值、无注释、不在任何索引内
-- （`idx_record_scene` / `idx_record_project` / `idx_record_status` 都不含它们），故去掉 NOT NULL 无副作用。
--
-- ── 回读验证（执行后）────────────────────────────────────────────────────────
--   SHOW COLUMNS FROM scene_card_generation_records LIKE 'plan\_message_id';       -- Null 应为 YES
--   SHOW COLUMNS FROM scene_card_generation_records LIKE 'application\_receipt_id'; -- Null 应为 YES
SET NAMES utf8mb4;

ALTER TABLE `scene_card_generation_records`
  MODIFY COLUMN `plan_message_id` BIGINT NULL,
  MODIFY COLUMN `application_receipt_id` BIGINT NULL;
