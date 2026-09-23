-- IKI8AZ：资产名称双轨基线片段。与 Prisma migration 同步。
ALTER TABLE `assets` ADD COLUMN `name` VARCHAR(255) NULL AFTER `type`;
