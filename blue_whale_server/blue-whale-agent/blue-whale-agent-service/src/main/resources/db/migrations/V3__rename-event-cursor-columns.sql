-- 迁移版本 V3：产品事件与 Outbox 游标物理列去保留字（IK1W1M）
-- `cursor` 是 MySQL 保留字，物理列改名为 event_cursor；Java 领域字段与 Snapshot/SSE 公开契约
-- 仍叫 cursor，由实体 @TableField("event_cursor") 显式映射。
-- RENAME COLUMN 保留全部既有值、类型/注释与索引（uk_project_cursor 自动指向新列），
-- (project_id, cursor) 顺序不变。不改 V1 基线文件（checksum 校验保护）。
-- 幂等：information_schema 守卫——列已改名（或不存在）时退化为 SELECT 1，重复执行安全。

SET @pe_has_cursor := (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'project_events' AND column_name = 'cursor');
SET @pe_rename := IF(@pe_has_cursor > 0,
    'ALTER TABLE project_events RENAME COLUMN `cursor` TO event_cursor',
    'SELECT 1');
PREPARE stmt_pe FROM @pe_rename;
EXECUTE stmt_pe;
DEALLOCATE PREPARE stmt_pe;

SET @om_has_cursor := (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'outbox_messages' AND column_name = 'cursor');
SET @om_rename := IF(@om_has_cursor > 0,
    'ALTER TABLE outbox_messages RENAME COLUMN `cursor` TO event_cursor',
    'SELECT 1');
PREPARE stmt_om FROM @om_rename;
EXECUTE stmt_om;
DEALLOCATE PREPARE stmt_om;
