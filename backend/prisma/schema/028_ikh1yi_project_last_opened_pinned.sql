-- IKH1YI：project 表加 last_opened_at / pinned_at 两列（2026-09-19）。
--
-- 变更：新增「上次打开时间」与「置顶时间」两列，均默认 NULL。
-- - last_opened_at：进入画布时服务端记录，列表用于「恢复落点」展示；
-- - pinned_at：非空即已置顶，置顶组内按此倒序；取消置顶由应用写 NULL。
-- - 两列写入不触碰 gmt_modified/version：gmt_modified 无 ON UPDATE、schema
--   无 @updatedAt，UPDATE 只写目标列即天然不动（IKH1YI 验收项）。
-- - 列表排序口径统一 [{ pinned_at: desc }, { gmt_create: desc }]：MySQL
--   DESC 下 NULL 排最后，未置顶组天然在后，无需 nulls 参数（不支持）。
--
-- 双轨：本文件与 backend/prisma/migrations/20260919190000_ikh1yi_project_last_opened_pinned/migration.sql、
--       docs/sql/20260919_ikh1yi_project_last_opened_pinned.sql 内容需逐字一致
--       （有 parity 测试断言）。

SET NAMES utf8mb4;

ALTER TABLE `project` ADD COLUMN `last_opened_at` DATETIME(0) NULL;
ALTER TABLE `project` ADD COLUMN `pinned_at` DATETIME(0) NULL;
