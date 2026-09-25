-- 用户可见流水行的展示文案快照（《计费逻辑详细设计》§2.3 / §2.3.1）
--
-- 版本号从 V6 起，不从 V5：V5 曾被「影子模式」占用（V5__shadow_entries.sql），
-- 该功能整体回滚时文件被删，但**版本号不随文件回收**——跑过它的库
-- （本地开发库就是）在 flyway_schema_history 里留着那一行。
-- 再发一个内容不同的 V5 会撞上「Migration checksum mismatch」，
-- 而把版本号退回去比多一个空号危险得多。
--
-- HoldRequest.title 的注释写的是「展示文案快照，**写进用户流水**」，而用户流水里的
-- 消费行是由 billing_cost_reservations 投影出来的。但这张表原先只存金额、分配明细与
-- 冻结的定价参数，**没有文案**——于是「这 40 分花在哪个任务上」事后无从回答：
--   模型 id 与任务类型都在 generation_jobs 上（属 backend 的库），
--   而 ADR-0113 的数据主权禁止 billing 跨库直连。
-- 所以文案只能在预扣时随预留一起存下来（预扣是唯一同时见到两者的一刻）。
--
-- 与「预扣」同生共死：文案是**快照**，不是引用——模型改名、任务标题生成规则变化，
-- 都不该改写历史流水。
--
-- DEFAULT '' 而不是 NULL：老数据（本迁移之前的预留）没有文案，
-- 空串让「读不到文案」与「文案就是空」在展示层是同一件事，省掉一次 null 分支。
ALTER TABLE billing_cost_reservations
  ADD COLUMN title VARCHAR(255) NOT NULL DEFAULT ''
    COMMENT '展示文案快照（HoldRequest.title）；空 = 提交时未提供'
    AFTER discount_bp;
