-- 迁移版本 V8：生成收件箱地基——Project 用途列、Conversations 放开单对话、Asset 来源追踪（IK21O9）
-- 背景：产品新增「生成收件箱」，一种 purpose=generation_inbox 的特殊 Project，
-- 每用户最多一个活动实例且从项目列表隐藏；收件箱允许多段独立 Conversation
-- （普通 canvas 项目保持事实上的单对话）；Asset 增加跨项目复制的来源追踪列。
-- 本版本完成四件事：
--   1. project 加 purpose 列与生成列 inbox_guard（未删除的收件箱取 owner_id，
--      其余为 NULL），对 inbox_guard 建唯一键——MySQL 唯一键把多个 NULL 视为
--      不同值，从而保证每用户最多一个未删除收件箱，canvas 项目不受约束；
--   2. conversations 丢弃 uk_conversation_project 唯一索引、改回普通索引，
--      放开一项目一对话的唯一约束；
--   3. assets 加 source_asset_id 列与普通索引，追踪跨项目复制的来源 Asset；
--   4. command_idempotency 加 resource_id 列，记录「首次接纳结果资源 ID」，
--      供收件箱建对话（inbox.conversation.create）与跨项目复制（asset.copy）
--      的幂等重放按它加载首次结果资源。
-- 收敛后做契约断言：purpose 列、uk_project_inbox_guard 唯一键、
-- uk_conversation_project 已不存在、assets.source_asset_id、
-- command_idempotency.resource_id 逐项核对，
-- 任一不满足即迁移失败 fail-closed（迁移器将异常记入 V8 failed 并终止，
-- 业务服务因就绪门禁不启动）。

-- ===== 1. project：purpose 列 + inbox_guard 生成列 + 唯一键 =====

ALTER TABLE project
    ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'canvas' COMMENT '项目用途：canvas 画布项目 / generation_inbox 生成收件箱';

ALTER TABLE project
    ADD COLUMN inbox_guard BIGINT GENERATED ALWAYS AS (CASE WHEN purpose = 'generation_inbox' AND is_delete = 0 THEN owner_id ELSE NULL END) STORED COMMENT '收件箱唯一守卫：未删除生成收件箱取 owner_id，其余为 NULL',
    ADD UNIQUE KEY uk_project_inbox_guard (inbox_guard);

-- ===== 2. conversations：放开一项目一对话 =====

ALTER TABLE conversations
    DROP INDEX uk_conversation_project,
    ADD INDEX idx_conversation_project (project_id);

-- ===== 3. assets：跨项目复制来源追踪 =====

ALTER TABLE assets
    ADD COLUMN source_asset_id BIGINT NULL COMMENT '跨项目复制的来源 Asset ID',
    ADD INDEX idx_asset_source_asset (source_asset_id);

-- ===== 4. command_idempotency：首次接纳结果资源 ID =====

ALTER TABLE command_idempotency
    ADD COLUMN resource_id BIGINT NULL COMMENT '首次接纳结果资源 ID（conversation/asset 等，按 operation 解释）';

-- ===== 5. 契约断言（fail-closed）=====
-- 逐项核对 information_schema，任一缺失即抛错：
-- MySQL 8 不允许在 prepared statement 中执行 SIGNAL（ERROR 1295），
-- 改为 PREPARE 一段语法非法文本，PREPARE 本身失败抛 ERROR 1064，
-- 其 near 片段携带违规详情（迁移器将异常记入 V8 failed 并终止）。

SET @missing := (
    SELECT GROUP_CONCAT(missing.what SEPARATOR ', ') FROM (
        (SELECT '缺列 project.purpose' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'project'
               AND COLUMN_NAME = 'purpose'
         ))
        UNION ALL
        (SELECT '缺唯一键 project.uk_project_inbox_guard' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'project'
               AND INDEX_NAME = 'uk_project_inbox_guard'
               AND NON_UNIQUE = 0
         ))
        UNION ALL
        (SELECT '唯一键 conversations.uk_conversation_project 仍存在' AS what
         FROM dual
         WHERE EXISTS (
             SELECT 1 FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'conversations'
               AND INDEX_NAME = 'uk_conversation_project'
         ))
        UNION ALL
        (SELECT '缺列 assets.source_asset_id' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'assets'
               AND COLUMN_NAME = 'source_asset_id'
         ))
        UNION ALL
        (SELECT '缺列 command_idempotency.resource_id' AS what
         FROM dual
         WHERE NOT EXISTS (
             SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'command_idempotency'
               AND COLUMN_NAME = 'resource_id'
         ))
    ) missing
);

SET @assert_sql := IF(@missing IS NULL,
    'SELECT ''V8 收件箱地基就绪'' AS v8_contract',
    CONCAT('V8_CONTRACT_VIOLATION [', SUBSTRING(@missing, 1, 200), ']'));
PREPARE stmt_assert FROM @assert_sql;
EXECUTE stmt_assert;
DEALLOCATE PREPARE stmt_assert;
