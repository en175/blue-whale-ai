-- 工单 IKDLQF | 2026-09-06 | canvas 表新增 edges_json，持久化画布连线（文本附件连接）。
SET NAMES utf8mb4;

-- IKDLQF: persist canvas edges (text attachment connections) alongside nodes.
ALTER TABLE `canvas` ADD COLUMN `edges_json` JSON NULL;
