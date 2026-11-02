SET NAMES utf8mb4;
RENAME TABLE `bw_admin_logs` TO `bw_operation_logs`;
ALTER TABLE `bw_operation_logs`
  ADD COLUMN `status` TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN `ref` VARCHAR(64) NULL,
  ADD INDEX `idx_bw_operation_logs__ref` (`ref`);
