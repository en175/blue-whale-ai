SET NAMES utf8mb4;

-- IKDLQF: persist canvas edges (text attachment connections) alongside nodes.
ALTER TABLE `canvas` ADD COLUMN `edges_json` JSON NULL;
